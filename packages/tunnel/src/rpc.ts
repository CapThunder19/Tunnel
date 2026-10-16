import { RelayUnavailableError, RpcResponseError } from './errors.js'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

let nextId = 1

/** One JSON-RPC call to one relay. Throws RelayUnavailableError or RpcResponseError. */
export async function rpcCall(
  relay: string,
  method: string,
  params: unknown,
  opts: { fetch?: FetchLike; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  let res: Response
  try {
    res = await doFetch(relay, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: params ?? [] }),
      signal: controller.signal,
    })
  } catch (cause) {
    throw new RelayUnavailableError(relay, `network error (${(cause as Error)?.message ?? cause})`, { cause })
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new RelayUnavailableError(relay, 'rate limited (429)', {
      status: 429,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    })
  }

  let body: any
  try {
    body = await res.json()
  } catch (cause) {
    throw new RelayUnavailableError(relay, `HTTP ${res.status}, body is not JSON`, { status: res.status, cause })
  }

  if (body && typeof body === 'object' && body.error && typeof body.error === 'object' && typeof body.error.code === 'number') {
    throw new RpcResponseError(relay, body.error.code, body.error.message ?? 'RPC error', body.error.data)
  }
  if (!res.ok || !body || typeof body !== 'object' || !('result' in body)) {
    // e.g. the gateway's {"error":"ANON_COST_LIMITED",...} shape, or a 5xx page
    const detail = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new RelayUnavailableError(relay, detail, { status: res.status })
  }
  return body.result
}
