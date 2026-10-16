import { describe, expect, it } from 'vitest'
import { handle, isAllowed } from '../src/core.js'

function upstream(result: unknown, init: ResponseInit = {}) {
  const seen: { headers: Record<string, string>; body: string }[] = []
  const fetch = (async (_url: string, req: RequestInit) => {
    seen.push({ headers: req.headers as Record<string, string>, body: String(req.body) })
    const id = JSON.parse(String(req.body)).id
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), init)
  }) as typeof globalThis.fetch
  return { fetch, seen }
}

const rpc = (method: string, params: unknown[] = []) => JSON.stringify({ jsonrpc: '2.0', id: 7, method, params })

describe('relay core', () => {
  it('allows eth_*, arkiv_*, net_version, web3_clientVersion only', () => {
    for (const m of ['eth_blockNumber', 'eth_sendRawTransaction', 'arkiv_query', 'net_version', 'web3_clientVersion']) expect(isAllowed(m)).toBe(true)
    for (const m of ['eth_sendTransaction', 'eth_sign', 'eth_signTypedData_v4', 'eth_accounts', 'admin_peers', 'debug_traceTransaction', 'personal_unlockAccount', 42])
      expect(isAllowed(m)).toBe(false)
  })

  it('rejects disallowed methods without calling upstream', async () => {
    const up = upstream('0x1')
    const res = await handle('POST', '/', rpc('admin_peers'), { fetch: up.fetch })
    expect(JSON.parse(res.body).error.code).toBe(-32601)
    expect(up.seen).toHaveLength(0)
  })

  it('forwards the body verbatim with the API key header, and sets CORS', async () => {
    const up = upstream('0xabc')
    const body = rpc('eth_blockNumber')
    const res = await handle('POST', '/', body, { fetch: up.fetch, apiKey: 'k-123' })
    expect(JSON.parse(res.body).result).toBe('0xabc')
    expect(up.seen[0].body).toBe(body)
    expect(up.seen[0].headers['x-api-key']).toBe('k-123')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('passes 429 and Retry-After through so clients rotate', async () => {
    const up = upstream(null, { status: 429, headers: { 'retry-after': '60' } })
    const res = await handle('POST', '/', rpc('arkiv_query', ['x', {}]), { fetch: up.fetch })
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('60')
  })

  it('answers preflight and /health', async () => {
    expect((await handle('OPTIONS', '/', '', {})).status).toBe(204)
    const up = upstream('0x10')
    const h = await handle('GET', '/health', '', { fetch: up.fetch, name: 'a' })
    expect(JSON.parse(h.body)).toMatchObject({ ok: true, name: 'a', head: '0x10' })
  })

  it('--lie tampers arkiv_query results (demo only)', async () => {
    const data = [{ key: '0x01', payload: '0x6869' }]
    const honest = await handle('POST', '/', rpc('arkiv_query', ['q', {}]), { fetch: upstream({ data, blockNumber: '0x1' }).fetch })
    const lying = await handle('POST', '/', rpc('arkiv_query', ['q', {}]), { fetch: upstream({ data, blockNumber: '0x1' }).fetch, lie: true })
    expect(JSON.parse(honest.body).result.data[0].payload).toBe('0x6869')
    expect(JSON.parse(lying.body).result.data[0].payload).not.toBe('0x6869')
  })
})
