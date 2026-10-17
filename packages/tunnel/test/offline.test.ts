import { ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { str, u64 } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { keccak256, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { broadcast, decode, encode, inspect, joinSms, signOffline, splitSms } from '../src/offline.js'

const notice = {
  expires: ExpirationTime.fromDays(90),
  payload: jsonToPayload({ text: 'Water point at the school is open 6-9 am.' }),
  contentType: 'application/json',
  attributes: { app: str('tunnel-demo'), type: str('notice'), district: str('north'), ts: u64(1760000000n) },
  flags: { readonly: true },
}

describe('offline signing', () => {
  it('signs with no network and the signature recovers to the stamp', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const key = generatePrivateKey()
    const raw = await signOffline(key, notice)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const tx = await inspect(raw)
    expect(tx.author).toBe(privateKeyToAccount(key).address)
    expect(tx.chainId).toBe(tiramisu.id)
    expect(tx.nonce).toBe(0)
    expect(tx.creates).toHaveLength(1)
    expect(tx.creates[0]).toMatchObject({
      readonly: true,
      expiresAt: 0n,
      minLifetimeBlocks: 3_888_000n,
      contentType: 'application/json',
      attributes: { app: 'tunnel-demo', type: 'notice', district: 'north', ts: 1760000000n },
    })
    expect(JSON.parse(tx.creates[0].payloadText!)).toEqual({ text: 'Water point at the school is open 6-9 am.' })
  })

  it('refuses absolute expiries, which need the live head', async () => {
    await expect(signOffline(generatePrivateKey(), { ...notice, expires: ExpirationTime.atBlock(10_000_000n) })).rejects.toThrow(/relative expiry/)
  })

  it('a carrier broadcasts it unchanged and cannot become the author', async () => {
    const key = generatePrivateKey()
    const raw = await signOffline(key, notice)
    const sent: Hex[] = []
    const via = { request: async ({ params }: { params: [Hex] }) => (sent.push(params[0]), keccak256(params[0])) }
    const res = await broadcast(await encode(raw), via as any)
    expect(sent).toEqual([raw])
    expect(res.hash).toBe(keccak256(raw))
    expect(res.author).toBe(privateKeyToAccount(key).address)
  })
})

describe('text encoding', () => {
  it('round-trips, ignoring whitespace and line breaks', async () => {
    const raw = await signOffline(generatePrivateKey(), notice)
    const text = await encode(raw)
    expect(text.startsWith('TNL1.')).toBe(true)
    expect(text.length).toBeLessThan(800)
    expect(await decode(text)).toBe(raw)
    expect(await decode(text.replace(/(.{40})/g, '$1\n  '))).toBe(raw)
  })

  it('detects a damaged character', async () => {
    const text = await encode(await signOffline(generatePrivateKey(), notice))
    for (const i of [30, 200, text.length - 10]) {
      const damaged = text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1)
      await expect(decode(damaged)).rejects.toThrow(/checksum/)
    }
  })

  it('splits into SMS parts and joins them in any order', async () => {
    const text = await encode(await signOffline(generatePrivateKey(), notice))
    const parts = splitSms(text)
    expect(parts.every((p) => p.length <= 150)).toBe(true)
    expect(parts.length).toBeLessThanOrEqual(6)
    expect(await decode(joinSms([...parts].reverse()))).toBe(await decode(text))
  })
})
