/**
 * Relay registry on Arkiv: relays announce themselves with a short lease that is renewed only while
 * they are healthy, so a dead relay drops out of the list on its own, with no server keeping it.
 *
 *   relay entity: app=tunnel, type=relay, url, region · 2 h lease · renewed hourly by extendEntity
 *
 * Clients trust a relay entity only if its `$creator` is a known operator.
 */
import { ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { addr, str } from '@arkiv-network/sdk/attr'
import { eq, or } from '@arkiv-network/sdk/query'
import type { Address, Hex } from 'viem'

export const RELAY_LEASE_HOURS = 2

export interface RelayEntry {
  key: Hex
  url: string
  region: string
  operator: Address
  expiresAt: bigint
}

interface Reader {
  select: (...args: any[]) => any
}

interface Operator extends Reader {
  account?: { address: Address } | undefined
  createEntity: (p: any) => Promise<{ entityKey: Hex; txHash: Hex }>
  extendEntity: (p: any) => Promise<{ entityKey: Hex; txHash: Hex }>
}

/** Live relay entities, optionally only those created by the given operators. */
export async function listRelays(client: Reader, operators?: string[]): Promise<RelayEntry[]> {
  const filters: any[] = [eq('app', 'tunnel'), eq('type', 'relay')]
  if (operators?.length) {
    const byOp = operators.map((o) => eq('$creator', addr(o as Address)))
    filters.push(byOp.length === 1 ? byOp[0] : or(...byOp))
  }
  const page = await client.select({ key: true, creator: true, expiresAt: true, attributes: true }).where(filters).limit(200).fetch()
  const seen = new Set<string>()
  const out: RelayEntry[] = []
  for (const e of page.entities) {
    const url = String(e.attributes?.url?.value ?? '')
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ key: e.key, url, region: String(e.attributes?.region?.value ?? ''), operator: e.creator, expiresAt: e.expiresAt })
  }
  return out
}

/**
 * One lease round for an operator: for each relay URL, if `/health` answers, renew its entity
 * (or create it), otherwise leave it to expire. Safe to run repeatedly (cron).
 */
export async function renewLeases(
  operator: Operator,
  relays: { url: string; region: string }[],
  opts: { health?: (url: string) => Promise<boolean>; leaseHours?: number } = {},
): Promise<{ url: string; action: 'created' | 'extended' | 'skipped-unhealthy'; txHash?: Hex }[]> {
  const me = operator.account?.address
  if (!me) throw new Error('renewLeases: operator wallet needs an account')
  const lease = ExpirationTime.fromHours(opts.leaseHours ?? RELAY_LEASE_HOURS)
  const health = opts.health ?? defaultHealth
  const existing = await listRelays(operator, [me])
  const results = []
  for (const r of relays) {
    if (!(await health(r.url))) {
      results.push({ url: r.url, action: 'skipped-unhealthy' as const })
      continue
    }
    const entry = existing.find((e) => e.url === r.url)
    if (entry) {
      const { txHash } = await operator.extendEntity({ entityKey: entry.key, expires: lease })
      results.push({ url: r.url, action: 'extended' as const, txHash })
    } else {
      const { txHash } = await operator.createEntity({
        expires: lease,
        payload: jsonToPayload({ url: r.url, region: r.region }),
        contentType: 'application/json',
        attributes: { app: str('tunnel'), type: str('relay'), url: str(r.url), region: str(r.region) },
      })
      results.push({ url: r.url, action: 'created' as const, txHash })
    }
  }
  return results
}

async function defaultHealth(url: string): Promise<boolean> {
  try {
    const healthUrl = url.endsWith('/api/rpc') ? url : `${url.replace(/\/$/, '')}/health`
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean; lie?: boolean }
    return body.ok === true && !body.lie
  } catch {
    return false
  }
}
