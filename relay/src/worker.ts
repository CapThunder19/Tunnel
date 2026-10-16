import { handle } from './core.js'

export interface Env {
  UPSTREAM?: string
  ARKIV_API_KEY?: string
  RELAY_NAME?: string
  RELAY_REGION?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.text() : ''
    const res = await handle(request.method, url.pathname, body, {
      upstream: env.UPSTREAM,
      apiKey: env.ARKIV_API_KEY,
      name: env.RELAY_NAME ?? 'tunnel-relay-cloudflare',
      region: env.RELAY_REGION ?? (request as any).cf?.colo,
    })
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
  },
}
