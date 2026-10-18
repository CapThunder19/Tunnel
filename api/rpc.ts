/**
 * Tunnel relay on Vercel Edge (second platform, same core as the Cloudflare Worker).
 * POST /api/rpc  JSON-RPC  ·  GET /api/rpc  health
 * Secret: ARKIV_API_KEY (Vercel project env var). Logs nothing.
 */
import { handle } from '../relay/src/core.js'

export const config = { runtime: 'edge' }

export default async function relay(request: Request): Promise<Response> {
  const body = request.method === 'POST' ? await request.text() : ''
  const res = await handle(request.method, request.method === 'GET' ? '/health' : '/', body, {
    upstream: process.env.UPSTREAM,
    apiKey: process.env.ARKIV_API_KEY,
    name: 'tunnel-relay-vercel',
    region: process.env.VERCEL_REGION ?? 'vercel-edge',
  })
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
}
