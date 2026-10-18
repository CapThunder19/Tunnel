import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { listRelays, type RelayEntry } from 'arkiv-tunnel'
import { webSocket } from 'viem'
import { errorText, h, short } from '../dom'
import { EXPLORER, publicClient, settings } from '../net'

export const WS_URL = 'wss://rpc.tiramisu.db-chain.testnet.arkiv.network'
/** Relay operators this app trusts. A relay entity counts only if its $creator is one of these. */
export const OPERATORS = (import.meta.env.VITE_RELAY_OPERATORS ?? '0x9Fb8276AA99d5778C7562E4A46A73536F3803164').split(',')

export function relaysTab(): HTMLElement {
  const status = h('p', { class: 'muted' }, 'Loading the relay registry from Arkiv…')
  const list = h('div', { class: 'notices' })
  const live = h('span', { class: 'pill' }, 'connecting…')
  const log = h('ul', { class: 'log' })
  const useBtn = h('button', {}, 'Use these relays')
  let relays: RelayEntry[] = []
  let head = 0n
  let headAt = Date.now()

  // Lease countdowns are computed locally from the last known head (2 s blocks): no polling.
  const minutesLeft = (r: RelayEntry) => Math.max(0, Math.round((Number(r.expiresAt - head) * 2 - (Date.now() - headAt) / 1000) / 60))

  function render() {
    list.replaceChildren(
      ...(relays.length
        ? relays.map((r) =>
            h(
              'article',
              { class: 'notice' },
              h('p', {}, h('span', { class: 'mono' }, r.url), ' ', h('span', { class: 'pill' }, r.region)),
              h(
                'p',
                { class: 'meta' },
                `lease ends in ~${minutesLeft(r)} min · operator ($creator) `,
                h('a', { href: `${EXPLORER}/address/${r.operator}`, target: '_blank', rel: 'noopener', class: 'mono' }, short(r.operator, 4)),
                ` · entity ${short(r.key, 6)}`,
              ),
            ),
          )
        : [h('p', { class: 'muted' }, 'No live relays: every lease has lapsed.')]),
    )
  }

  let loading: Promise<void> | undefined
  async function load(reason?: string) {
    if (loading) return loading
    loading = (async () => {
      try {
        const client = publicClient()
        ;[relays, head] = await Promise.all([listRelays(client, OPERATORS), client.getBlockNumber()])
        headAt = Date.now()
        status.className = 'muted'
        status.textContent = `${relays.length} live relay(s), from operators you trust${reason ? ` · refreshed: ${reason}` : ''}`
        render()
      } catch (err) {
        status.className = 'error'
        status.textContent = errorText(err)
      } finally {
        loading = undefined
      }
    })()
    return loading
  }

  useBtn.addEventListener('click', () => {
    if (!relays.length) return
    const s = settings.get()
    settings.set({ ...s, relays: relays.map((r) => r.url) })
    status.textContent = `Now using ${relays.length} relays from the registry (see Connection).`
  })

  // Live updates: a real WebSocket subscription (no fromBlock, so no polling). Events carry entity
  // keys, not attributes, so a renewal of a relay we show is matched by key, and any new entity
  // triggers a (debounced) re-read in case it is a new relay.
  let debounce: ReturnType<typeof setTimeout> | undefined
  try {
    const ws = createPublicClient({ chain: tiramisu, transport: webSocket(WS_URL) })
    ws.watchEntityEvents({
      onExpiryExtended: (e) => {
        const r = relays.find((x) => x.key === e.entityKey)
        if (!r) return
        r.expiresAt = e.expiresAt
        log.prepend(h('li', {}, `↻ lease renewed: ${r.url} (block ${e.blockNumber})`))
        render()
      },
      onEntityCreated: () => {
        clearTimeout(debounce)
        debounce = setTimeout(() => load('new entity on chain'), 4000)
      },
      onEntityDeleted: (e) => {
        if (relays.some((x) => x.key === e.entityKey)) load('relay entity deleted')
      },
      onError: () => {
        live.textContent = 'live updates unavailable (WebSocket blocked?)'
        live.className = 'pill down'
      },
    })
    live.textContent = 'live (WebSocket)'
    live.className = 'pill ok'
  } catch {
    live.textContent = 'live updates unavailable'
    live.className = 'pill down'
  }

  setInterval(render, 30_000) // countdown text only, no network
  load()

  return h(
    'section',
    {},
    h('h2', {}, 'Relays ', live),
    h(
      'p',
      { class: 'muted' },
      'Relays are listed on Arkiv, not in a config file we control. Each relay entity has a 2-hour lease that the operator renews every hour with extendEntity, and only while the relay passes a health check. A relay that dies simply drops out when its lease lapses. Only entities whose $creator is a trusted operator count.',
    ),
    status,
    list,
    h('div', { class: 'row' }, useBtn),
    h('p', { class: 'small muted' }, 'Trusted operators: ', ...OPERATORS.map((o: string) => h('span', { class: 'mono' }, short(o, 4) + ' '))),
    log,
  )
}
