import { createPublicClient } from 'viem'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { attest, makeBundle, takeSnapshot } from '../src/snapshot.js'
import { tunnel } from '../src/transport.js'
import { verifyOffline, type Bundle } from '../src/verify.js'
import { fakeNet, HEAD, type Behaviour } from './fakeNet.js'

const QUERY = `app = str('tunnel-demo') AND type = str('notice')`

function client(b: Record<string, Behaviour>) {
  return createPublicClient({ chain: tiramisu, transport: tunnel(Object.keys(b), { fetch: fakeNet(b).fetch }) })
}

function witnessWallet() {
  const account = privateKeyToAccount(generatePrivateKey())
  const created: any[] = []
  return {
    account,
    created,
    signMessage: ({ message }: { message: string }) => account.signMessage({ message }),
    createEntity: async (p: any) => (created.push(p), { entityKey: ('0x' + '0e'.repeat(32)) as `0x${string}`, txHash: ('0x' + '0f'.repeat(32)) as `0x${string}` }),
  }
}

async function certified(n = 3) {
  const reader = client({ 'https://r1': 'honest', 'https://r2': 'honest' })
  const snap = await takeSnapshot(reader, QUERY)
  const wallets = Array.from({ length: n }, witnessWallet)
  const atts = []
  for (const w of wallets) atts.push(await attest(snap, w, client({ 'https://r3': 'honest', 'https://r2': 'honest' })))
  return { bundle: makeBundle(snap, atts), wallets, trusted: wallets.map((w) => w.account.address) }
}

describe('certified copy', () => {
  it('snapshots a pinned block with its time', async () => {
    const snap = await takeSnapshot(client({ 'https://r1': 'honest', 'https://r2': 'honest' }), QUERY)
    expect(snap.block).toBe((HEAD - 2n).toString())
    expect(snap.blockTime).toBe(0x6700a000)
    expect(snap.entities).toHaveLength(2)
    expect(snap.chainId).toBe(tiramisu.id)
  })

  it('attestation writes a readonly, community-extendable attestation entity', async () => {
    const { wallets, bundle } = await certified(1)
    const p = wallets[0].created[0]
    expect(p.flags).toEqual({ readonly: true, permissionlessExtension: true })
    expect(p.attributes.type.value).toBe('attestation')
    expect(p.attributes.hash.value).toBe(bundle.snapshot.hash)
    expect(p.attributes.block).toMatchObject({ type: 'u64', value: HEAD - 2n })
  })

  it('verifies offline with all trusted witnesses', async () => {
    const { bundle, trusted } = await certified(3)
    const r = await verifyOffline(JSON.parse(JSON.stringify(bundle)), trusted)
    expect(r).toMatchObject({ authentic: true, contentIntact: true, trustedCount: 3, entityCount: 2 })
    expect(r.problems).toEqual([])
  })

  it('flags a copy where one byte of content changed', async () => {
    const { bundle, trusted } = await certified(3)
    const tampered: Bundle = JSON.parse(JSON.stringify(bundle))
    const e = tampered.snapshot.entities[0] as { payload: string }
    e.payload = e.payload.slice(0, -1) + (e.payload.endsWith('0') ? '1' : '0')
    const r = await verifyOffline(tampered, trusted)
    expect(r.authentic).toBe(false)
    expect(r.contentIntact).toBe(false)
    expect(r.trustedCount).toBe(0)
  })

  it('flags a copy whose hash was recomputed to match tampered content', async () => {
    const { bundle, trusted } = await certified(2)
    const { hashEntities } = await import('../src/canonical.js')
    const t: Bundle = JSON.parse(JSON.stringify(bundle))
    t.snapshot.entities.pop()
    t.snapshot.hash = hashEntities(t.snapshot.entities)
    const r = await verifyOffline(t, trusted)
    expect(r.contentIntact).toBe(true)
    expect(r.trustedCount).toBe(0) // signatures no longer match
    expect(r.authentic).toBe(false)
  })

  it('does not count untrusted or duplicate witnesses, and rejects a faked age', async () => {
    const { bundle, trusted } = await certified(2)
    const r1 = await verifyOffline(bundle, [trusted[0]])
    expect(r1.trustedCount).toBe(1)
    const dup: Bundle = { ...bundle, attestations: [bundle.attestations[0], bundle.attestations[0]] }
    expect((await verifyOffline(dup, trusted)).trustedCount).toBe(1)
    const aged: Bundle = JSON.parse(JSON.stringify(bundle))
    aged.snapshot.blockTime += 86400
    expect((await verifyOffline(aged, trusted)).trustedCount).toBe(0)
  })

  it('a witness refuses to attest when its own read disagrees', async () => {
    const snap = await takeSnapshot(client({ 'https://liarA': 'lie', 'https://liarB': 'lie' }), QUERY)
    await expect(attest(snap, witnessWallet(), client({ 'https://r1': 'honest', 'https://r2': 'honest' }))).rejects.toThrow(/refusing/)
  })
})
