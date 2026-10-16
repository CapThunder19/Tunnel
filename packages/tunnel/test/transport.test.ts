import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { createPublicClient as createViemClient, createWalletClient, keccak256, parseGwei } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { findTunnelError, NoHealthyRelayError, RelayDisagreement } from '../src/errors.js'
import { tunnel, type TunnelEvent } from '../src/transport.js'
import { fakeNet, HEAD, type Behaviour } from './fakeNet.js'

function setup(behaviours: Record<string, Behaviour>, opts: { quorum?: number } = {}) {
  const net = fakeNet(behaviours)
  const events: TunnelEvent[] = []
  const transport = tunnel(Object.keys(behaviours), { ...opts, fetch: net.fetch, onEvent: (e) => events.push(e) })
  const client = createPublicClient({ chain: tiramisu, transport })
  const viemClient = createViemClient({ chain: tiramisu, transport })
  const query = () => client.select('*').where(eq('type', 'notice')).fetch()
  return { net, events, pool: transport.pool, client, viemClient, query }
}

describe('quorum reads', () => {
  it('pins a block and returns the agreed result through the real SDK', async () => {
    const { net, events, query } = setup({ 'https://r1': 'honest', 'https://r2': 'honest' })
    const page = await query()
    expect(page.entities).toHaveLength(2)
    const queries = net.calls.filter((c) => c.method === 'arkiv_query')
    expect(queries).toHaveLength(2)
    // both relays were asked at the same pinned block: median head minus margin
    expect(new Set(queries.map((c) => c.params[1].atBlock))).toEqual(new Set(['0x' + (HEAD - 2n).toString(16)]))
    const read = events.find((e) => e.type === 'read')
    expect(read).toMatchObject({ block: HEAD - 2n, agreed: ['https://r1', 'https://r2'] })
  })

  it('flags a lying relay when a third relay breaks the tie', async () => {
    const { events, pool, query } = setup({ 'https://r1': 'honest', 'https://liar': 'lie', 'https://r2': 'honest' })
    // order of usable() is stable for unknown relays: r1 and liar are asked first
    const page = await query()
    expect(page.entities.map((e) => e.toText()).sort()).toEqual(['hello', 'world'])
    expect(pool.status().find((r) => r.url === 'https://liar')?.state).toBe('bad')
    const d = events.find((e) => e.type === 'disagreement')
    expect(d).toMatchObject({ bad: ['https://liar'] })

    // next read skips the liar entirely
    await query()
    const reads = events.filter((e) => e.type === 'read')
    expect(reads.at(-1)).toMatchObject({ agreed: ['https://r1', 'https://r2'] })
  })

  it('throws RelayDisagreement when there is no majority', async () => {
    const { query, events } = setup({ 'https://r1': 'honest', 'https://liar': 'lie' })
    const err = await query().catch((e) => e)
    expect(findTunnelError(err, RelayDisagreement)?.answers).toHaveLength(2)
    expect(events.some((e) => e.type === 'disagreement')).toBe(true)
  })

  it('rotates past down and rate-limited relays', async () => {
    const { pool, query } = setup({
      'https://dead': 'down',
      'https://busy': 'ratelimit',
      'https://r1': 'honest',
      'https://r2': 'honest',
    })
    const page = await query()
    expect(page.entities).toHaveLength(2)
    const status = Object.fromEntries(pool.status().map((r) => [r.url, r.state]))
    expect(status).toMatchObject({ 'https://dead': 'down', 'https://busy': 'down', 'https://r1': 'ok', 'https://r2': 'ok' })
    expect(pool.status().find((r) => r.url === 'https://busy')?.lastError).toMatch(/429/)
  })

  it('fails loudly instead of trusting a single relay', async () => {
    const { query } = setup({ 'https://r1': 'honest', 'https://dead': 'down' })
    const err = await query().catch((e) => e)
    expect(findTunnelError(err, NoHealthyRelayError)).toBeDefined()
  })

  it('answers eth_chainId locally', async () => {
    const { net, client } = setup({ 'https://r1': 'honest' })
    expect(await client.getChainId()).toBe(tiramisu.id)
    expect(net.calls).toHaveLength(0)
  })
})

describe('writes', () => {
  const account = privateKeyToAccount(('0x' + '42'.repeat(32)) as `0x${string}`)

  async function signed() {
    return account.signTransaction({
      chainId: tiramisu.id,
      to: account.address,
      nonce: 0,
      gas: 21000n,
      maxFeePerGas: parseGwei('1'),
      maxPriorityFeePerGas: parseGwei('1'),
      type: 'eip1559',
    })
  }

  it('broadcasts to every relay and succeeds if any accepts', async () => {
    const { net, events, viemClient: client } = setup({ 'https://r1': 'honest', 'https://dead': 'down', 'https://r2': 'honest' })
    const raw = await signed()
    const hash = await client.sendRawTransaction({ serializedTransaction: raw })
    expect(hash).toBe(keccak256(raw))
    expect(net.calls.filter((c) => c.method === 'eth_sendRawTransaction')).toHaveLength(3)
    const w = events.find((e) => e.type === 'write')
    expect(w).toMatchObject({ accepted: ['https://r1', 'https://r2'] })
    expect((w as any).failed).toHaveLength(1)
  })

  it('flags a relay that lies about the tx hash', async () => {
    const { pool, viemClient: client } = setup({ 'https://r1': 'honest', 'https://evil': 'wronghash' })
    const raw = await signed()
    expect(await client.sendRawTransaction({ serializedTransaction: raw })).toBe(keccak256(raw))
    expect(pool.status().find((r) => r.url === 'https://evil')?.state).toBe('bad')
  })

  it('works as a wallet client transport (signs locally, relays only see the raw tx)', async () => {
    const net = fakeNet({ 'https://r1': 'honest', 'https://r2': 'honest' })
    const wallet = createWalletClient({ account, chain: tiramisu, transport: tunnel(['https://r1', 'https://r2'], { fetch: net.fetch }) })
    const raw = await signed()
    await wallet.sendRawTransaction({ serializedTransaction: raw })
    expect(net.calls.every((c) => c.method === 'eth_sendRawTransaction')).toBe(true)
  })
})
