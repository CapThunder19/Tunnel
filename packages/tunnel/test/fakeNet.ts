import type { FetchLike } from '../src/rpc.js'

export type Behaviour = 'honest' | 'lie' | 'down' | 'ratelimit' | 'wronghash'

export const ENTITIES = [
  {
    key: '0x' + 'bb'.repeat(32),
    creator: '0x' + '11'.repeat(20),
    owner: '0x' + '11'.repeat(20),
    expiresAt: '0x1000',
    payload: '0x68656c6c6f',
    attributes: [
      { name: 'type', type: 'str', value: 'notice' },
      { name: 'app', type: 'str', value: 'tunnel-demo' },
      { name: 'ts', type: 'u64', value: '0x10' },
    ],
  },
  {
    key: '0x' + 'aa'.repeat(32),
    creator: '0x' + '22'.repeat(20),
    owner: '0x' + '22'.repeat(20),
    expiresAt: '0x2000',
    payload: '0x776f726c64',
    attributes: [
      { name: 'app', type: 'str', value: 'tunnel-demo' },
      { name: 'type', type: 'str', value: 'notice' },
      { name: 'ts', type: 'u64', value: '0x20' },
    ],
  },
]

export const HEAD = 1000n

/** A set of in-memory relays that all front the same fake node, with per-relay misbehaviour. */
export function fakeNet(behaviours: Record<string, Behaviour>) {
  const calls: { relay: string; method: string; params: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    const req = JSON.parse(String(init.body))
    calls.push({ relay: url, method: req.method, params: req.params })
    const b = behaviours[url]
    if (b === 'down') throw new TypeError('fetch failed')
    if (b === 'ratelimit') {
      return new Response(JSON.stringify({ error: 'ANON_COST_LIMITED', message: 'budget exhausted' }), {
        status: 429,
        headers: { 'retry-after': '30' },
      })
    }
    const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }))
    switch (req.method) {
      case 'eth_blockNumber':
        return ok('0x' + HEAD.toString(16))
      case 'eth_chainId':
        return ok('0x7614d1')
      case 'arkiv_query': {
        let data = structuredClone(ENTITIES)
        // honest relays return the same set in a different order, to exercise canonicalisation
        if (url.endsWith('2')) data = data.reverse().map((e) => ({ ...e, attributes: [...e.attributes].reverse() }))
        if (b === 'lie') data[0].payload = '0x6c6965' // "lie"
        return ok({ data, blockNumber: req.params[1].atBlock ?? '0x' + HEAD.toString(16) })
      }
      case 'eth_sendRawTransaction': {
        const { keccak256 } = await import('viem')
        return ok(b === 'wronghash' ? '0x' + 'de'.repeat(32) : keccak256(req.params[0]))
      }
      default:
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } }))
    }
  }
  return { fetch, calls }
}
