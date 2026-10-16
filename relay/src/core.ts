/**
 * Tunnel relay core: a stateless JSON-RPC forwarder to the Arkiv node.
 *
 * It runs unchanged on Cloudflare Workers, Vercel Edge and Node (it only uses `fetch`). It never
 * logs IPs or request bodies. It cannot forge writes (transactions are signed on the user's
 * device), and clients catch forged reads by comparing relays at a pinned block.
 */

export const DEFAULT_UPSTREAM = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
const MAX_BODY_BYTES = 256 * 1024
const MAX_BATCH = 20

/** Methods the relay forwards. Everything else gets JSON-RPC error -32601. */
const DENIED = new Set(['eth_sendTransaction', 'eth_sign', 'eth_signTransaction', 'eth_signTypedData', 'eth_accounts', 'eth_coinbase'])
export function isAllowed(method: unknown): boolean {
  if (typeof method !== 'string') return false
  if (DENIED.has(method) || method.startsWith('eth_signTypedData')) return false
  return method.startsWith('eth_') || method.startsWith('arkiv_') || method === 'net_version' || method === 'web3_clientVersion'
}

export interface RelayConfig {
  upstream?: string
  /** Arkiv Hub access key, sent upstream as X-API-KEY. Lives only in the relay's secrets. */
  apiKey?: string
  name?: string
  region?: string
  /** DEMO ONLY: tamper with arkiv_query results so clients can be seen flagging this relay. */
  lie?: boolean
  fetch?: typeof fetch
}

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '86400',
}

export interface RelayResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const json = (status: number, value: unknown, extra: Record<string, string> = {}): RelayResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extra },
  body: JSON.stringify(value),
})

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Handle one HTTP request. `path` is the URL pathname. */
export async function handle(method: string, path: string, bodyText: string, cfg: RelayConfig): Promise<RelayResponse> {
  if (method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS, body: '' }
  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) return health(cfg)
  if (method !== 'POST') return json(405, { error: 'POST JSON-RPC, or GET /health' })
  if (bodyText.length > MAX_BODY_BYTES) return json(413, rpcError(null, -32600, 'request too large'))

  let req: any
  try {
    req = JSON.parse(bodyText)
  } catch {
    return json(400, rpcError(null, -32700, 'parse error'))
  }

  const calls: any[] = Array.isArray(req) ? req : [req]
  if (calls.length === 0 || calls.length > MAX_BATCH) return json(400, rpcError(null, -32600, `batch must have 1..${MAX_BATCH} calls`))
  const rejected = calls.find((c) => !c || typeof c !== 'object' || !isAllowed(c.method))
  if (rejected) return json(200, rpcError(rejected?.id, -32601, `method not allowed by relay: ${String(rejected?.method)}`))

  const doFetch = cfg.fetch ?? fetch
  let upstream: Response
  try {
    upstream = await doFetch(cfg.upstream ?? DEFAULT_UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) },
      body: bodyText,
    })
  } catch {
    return json(502, rpcError(Array.isArray(req) ? null : req.id, -32603, 'upstream unreachable'))
  }

  const passHeaders: Record<string, string> = {}
  const retryAfter = upstream.headers.get('retry-after')
  if (retryAfter) passHeaders['retry-after'] = retryAfter
  let text = await upstream.text()
  if (cfg.lie && upstream.ok) text = tamper(calls, text)
  return { status: upstream.status, headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...passHeaders }, body: text }
}

async function health(cfg: RelayConfig): Promise<RelayResponse> {
  const doFetch = cfg.fetch ?? fetch
  let head: string | null = null
  try {
    const r = await doFetch(cfg.upstream ?? DEFAULT_UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    })
    head = ((await r.json()) as any)?.result ?? null
  } catch {
    // reported as head: null
  }
  return json(head ? 200 : 503, { ok: head !== null, name: cfg.name ?? 'tunnel-relay', region: cfg.region ?? 'unknown', head, lie: cfg.lie ? true : undefined })
}

/** DEMO ONLY. Rewrites the payload of the first entity of every arkiv_query result. */
function tamper(calls: any[], text: string): string {
  try {
    const parsed = JSON.parse(text)
    const responses = Array.isArray(parsed) ? parsed : [parsed]
    for (const res of responses) {
      const call = calls.find((c) => c.id === res?.id)
      const first = res?.result?.data?.[0]
      if (call?.method !== 'arkiv_query' || !first) continue
      if (typeof first.payload === 'string') {
        first.payload = '0x' + Array.from(new TextEncoder().encode('{"text":"All clear, nothing to see here."}'), (b) => b.toString(16).padStart(2, '0')).join('')
      } else if (Array.isArray(first.attributes) && first.attributes.length > 0) {
        first.attributes[0] = { ...first.attributes[0], value: 'tampered' }
      } else {
        res.result.data.pop()
      }
    }
    return JSON.stringify(Array.isArray(parsed) ? responses : responses[0])
  } catch {
    return text
  }
}
