import { createPublicClient, createWalletClient, ExpirationTime, jsonToPayload, type CreateEntityParameters } from '@arkiv-network/sdk'
import { str, u64 } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { tunnel, type Stamp, type TunnelTransport } from 'arkiv-tunnel'
import { http, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { store } from './dom'

export const EXPLORER = 'https://tiramisu.explorer.arkiv.network'
export const DIRECT_RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
export const APP = 'tunnel-demo'
export const DISTRICTS = ['central', 'north', 'south', 'east', 'west'] as const

const env = import.meta.env
const DEFAULT_RELAYS = (env.VITE_RELAYS ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',').map((s: string) => s.trim()).filter(Boolean)
export const LIAR_RELAY: string | undefined = env.VITE_LIAR_RELAY || (env.DEV ? 'http://127.0.0.1:8789' : undefined)

export const settings = store('tunnel.settings', {
  relays: DEFAULT_RELAYS as string[],
  includeLiar: false,
  mode: 'tunnel' as 'tunnel' | 'direct',
})

export const deviceKey = store<Hex | null>('tunnel.deviceKey', null)
export const stampStore = store<Stamp[]>('tunnel.stamps', [])

/** A demo key kept in this browser only (testnet). Created on first use. */
export function device() {
  let key = deviceKey.get()
  if (!key) {
    key = generatePrivateKey()
    deviceKey.set(key)
  }
  return privateKeyToAccount(key)
}

export function activeRelays(): string[] {
  const s = settings.get()
  // the liar goes first so it is always in the first quorum round (demo)
  return s.includeLiar && LIAR_RELAY ? [LIAR_RELAY, ...s.relays] : s.relays
}

let current: { key: string; transport: TunnelTransport | ReturnType<typeof http> } | undefined
const listeners = new Set<() => void>()
export const onNetChange = (fn: () => void) => listeners.add(fn)

/** The one transport the whole app uses: Tunnel relays, or (to show the failure) the direct RPC. */
export function transport() {
  const s = settings.get()
  const key = s.mode + '|' + activeRelays().join(',')
  if (!current || current.key !== key) {
    current = { key, transport: s.mode === 'direct' ? http(DIRECT_RPC, { retryCount: 0, timeout: 10_000 }) : tunnel(activeRelays()) }
    for (const l of listeners) l()
  }
  return current.transport
}

export const pool = () => (transport() as Partial<TunnelTransport>).pool

export const publicClient = () => createPublicClient({ chain: tiramisu, transport: transport() })
export const walletClient = (key?: Hex) =>
  createWalletClient({ chain: tiramisu, transport: transport(), account: key ? privateKeyToAccount(key) : device() })

export interface Notice {
  key: Hex
  creator: Hex
  district: string
  ts: number
  text: string
  expiresAt?: bigint
}

/** The `notice` entity: see /arkiv/schema.md. */
export function noticeParams(text: string, district: string): CreateEntityParameters {
  return {
    expires: ExpirationTime.fromDays(90),
    payload: jsonToPayload({ text }),
    contentType: 'application/json',
    attributes: { app: str(APP), type: str('notice'), district: str(district), ts: u64(BigInt(Math.floor(Date.now() / 1000))) },
    flags: { readonly: true },
  }
}

/** Decoded attributes are `{ type, value }` pairs. */
export function attrValue(attributes: unknown, name: string): unknown {
  const a = (attributes as Record<string, { value?: unknown } | undefined> | undefined)?.[name]
  return a && typeof a === 'object' && 'value' in a ? a.value : a
}

export async function fetchNotices(district?: string): Promise<{ notices: Notice[]; block: bigint }> {
  const filters = [eq('app', APP), eq('type', 'notice')]
  if (district) filters.push(eq('district', district))
  const page = await publicClient().select('*').where(filters).limit(100).fetch()
  const notices = page.entities.map((e) => {
    let text = ''
    try {
      text = String((e.toJson() as { text?: unknown }).text ?? '')
    } catch {
      text = '(unreadable payload)'
    }
    return {
      key: e.key as Hex,
      creator: e.creator as Hex,
      district: String(attrValue(e.attributes, 'district') ?? ''),
      ts: Number(attrValue(e.attributes, 'ts') ?? 0),
      text,
      expiresAt: e.expiresAt,
    }
  })
  notices.sort((a, b) => b.ts - a.ts)
  return { notices, block: page.blockNumber }
}
