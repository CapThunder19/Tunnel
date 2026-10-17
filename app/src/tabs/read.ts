import { findTunnelError, NoHealthyRelayError, RelayDisagreement, type TunnelEvent } from 'arkiv-tunnel'
import { errorText, h, short } from '../dom'
import { DISTRICTS, EXPLORER, fetchNotices, onNetChange, pool, settings, type Notice } from '../net'

export function readTab(): HTMLElement {
  const district = h('select', {}, h('option', { value: '' }, 'All districts'), ...DISTRICTS.map((d) => h('option', { value: d }, d)))
  const status = h('p', { class: 'muted' }, 'Not loaded yet.')
  const list = h('div', { class: 'notices' })
  const relayTable = h('div')
  const log = h('ul', { class: 'log' })
  const button = h('button', { class: 'primary' }, 'Load notices')

  function renderRelays() {
    const p = pool()
    relayTable.replaceChildren(
      p
        ? h(
            'table',
            { class: 'relays' },
            h('tr', {}, h('th', {}, 'Relay'), h('th', {}, 'State'), h('th', {}, 'Last answer hash'), h('th', {}, 'Note')),
            ...p.status().map((r) =>
              h(
                'tr',
                { class: `state-${r.state}` },
                h('td', {}, r.url),
                h('td', {}, h('span', { class: `pill ${r.state}` }, r.state === 'ok' ? 'agree' : r.state === 'bad' ? 'disagree' : r.state)),
                h('td', { class: 'mono' }, r.lastHash ? short(r.lastHash, 6) : '–'),
                h('td', { class: 'muted' }, r.lastError ?? ''),
              ),
            ),
          )
        : h('p', { class: 'warn' }, 'Direct mode: talking to the Arkiv RPC with no relays, no quorum, no checks.'),
    )
  }

  function onEvent(e: TunnelEvent) {
    if (e.type === 'read') log.prepend(h('li', {}, `✔ ${e.agreed.length} relays agreed at block ${e.block} (hash ${short(e.hash, 6)})`))
    if (e.type === 'disagreement')
      log.prepend(h('li', { class: 'bad' }, `✖ disagreement at block ${e.block}: ${e.bad.length ? 'flagged ' + e.bad.join(', ') : 'no majority'}`))
    renderRelays()
  }

  let unsubscribe: (() => void) | undefined
  const attach = () => {
    unsubscribe?.()
    unsubscribe = pool()?.on(onEvent)
    renderRelays()
  }
  onNetChange(attach)
  attach()

  async function load() {
    button.disabled = true
    status.className = 'muted'
    status.textContent = settings.get().mode === 'tunnel' ? 'Pinning a block and asking relays…' : 'Asking the Arkiv RPC directly…'
    const started = performance.now()
    try {
      const { notices, block } = await fetchNotices(district.value || undefined)
      status.textContent = `${notices.length} notices · read at block ${block} · ${Math.round(performance.now() - started)} ms`
      list.replaceChildren(...(notices.length ? notices.map(card) : [h('p', { class: 'muted' }, 'No notices yet. Post one in the Write tab.')]))
    } catch (err) {
      status.className = 'error'
      const d = findTunnelError(err, RelayDisagreement)
      const n = findTunnelError(err, NoHealthyRelayError)
      status.textContent = d
        ? `Relays disagree and there is no majority, so nothing is shown. ${d.answers.map((a) => `${a.relay}: ${short(a.hash, 4)}`).join(' · ')}`
        : n
          ? `Not enough relays answered: ${n.message}`
          : `Failed: ${errorText(err)}`
    } finally {
      button.disabled = false
      renderRelays()
    }
  }
  button.addEventListener('click', load)

  return h(
    'section',
    {},
    h('h2', {}, 'Read notices'),
    h(
      'p',
      { class: 'muted' },
      'Every query is pinned to one block and sent to several relays. Their canonical result hashes must match; a relay that disagrees with the majority is flagged and dropped.',
    ),
    h('div', { class: 'row' }, district, button),
    status,
    list,
    h('h3', {}, 'Relays'),
    relayTable,
    log,
  )
}

export function card(n: Notice): HTMLElement {
  return h(
    'article',
    { class: 'notice' },
    h('div', { class: 'meta' }, h('span', { class: 'pill' }, n.district || '?'), ' ', new Date(n.ts * 1000).toLocaleString()),
    h('p', {}, n.text),
    h(
      'div',
      { class: 'meta' },
      'author ($creator) ',
      h('a', { href: `${EXPLORER}/address/${n.creator}`, target: '_blank', rel: 'noopener', class: 'mono' }, short(n.creator, 6)),
      ' · key ',
      h('span', { class: 'mono' }, short(n.key, 6)),
    ),
  )
}
