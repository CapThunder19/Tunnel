import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { renewLeases } from '../../packages/tunnel/src/registry.js'
import { DEFAULT_UPSTREAM, handle } from './core.js'

export interface Env {
  UPSTREAM?: string
  ARKIV_API_KEY?: string
  RELAY_NAME?: string
  RELAY_REGION?: string
  /** DEMO ONLY: "1" makes this deployment tamper with query results (deployed as tunnel-relay-liar). */
  LIE?: string
  /** Secret. Relay operator key: renews this operator's `relay` leases on Arkiv from the cron. */
  OPERATOR_KEY?: string
  /** Relays this operator vouches for, "url|region,url|region". The first one is this Worker. */
  ANNOUNCE?: string
}

const cfgFor = (env: Env, request?: Request) => ({
  upstream: env.UPSTREAM,
  apiKey: env.ARKIV_API_KEY,
  name: env.RELAY_NAME ?? 'tunnel-relay-cloudflare',
  region: env.RELAY_REGION ?? (request as any)?.cf?.colo,
  lie: env.LIE === '1',
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.text() : ''
    const res = await handle(request.method, url.pathname, body, cfgFor(env, request))
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
  },

  /** Hourly: renew the 2 h lease of every announced relay that is healthy; dead ones lapse. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.OPERATOR_KEY || !env.ANNOUNCE || env.LIE === '1') return
    const relays = env.ANNOUNCE.split(',')
      .map((s) => s.trim().split('|'))
      .filter(([u]) => u)
      .map(([url, region]) => ({ url, region: region ?? 'unknown' }))
    const transport = http(env.UPSTREAM ?? DEFAULT_UPSTREAM, {
      fetchOptions: env.ARKIV_API_KEY ? { headers: { 'x-api-key': env.ARKIV_API_KEY } } : undefined,
    })
    const operator = createWalletClient({ chain: tiramisu, transport, account: privateKeyToAccount(env.OPERATOR_KEY as `0x${string}`) })
    const reader = createPublicClient({ chain: tiramisu, transport })
    const self = relays[0]?.url
    const results = await renewLeases(Object.assign(operator, { select: reader.select.bind(reader) }), relays, {
      // A Worker cannot reliably fetch its own workers.dev URL, so check itself via its upstream.
      health: async (u) => {
        if (u === self) return (await handle('GET', '/health', '', cfgFor(env))).status === 200
        try {
          const r = await fetch(u.endsWith('/api/rpc') ? u : `${u}/health`, { signal: AbortSignal.timeout(10_000) })
          const j = (await r.json()) as { ok?: boolean; lie?: boolean }
          return r.ok && j.ok === true && !j.lie
        } catch {
          return false
        }
      },
    })
    // Only lease outcomes are logged: no request data ever reaches this code path.
    console.log(JSON.stringify(results))
  },
}
