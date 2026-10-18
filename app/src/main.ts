import './style.css'
import { h } from './dom'
import { activeRelays, LIAR_RELAY, onNetChange, settings } from './net'
import { carryTab } from './tabs/carry'
import { offlineTab } from './tabs/offline'
import { readTab } from './tabs/read'
import { relaysTab } from './tabs/relays'
import { verifyTab } from './tabs/verify'
import { writeTab } from './tabs/write'

const tabs = [
  { id: 'read', label: 'Read', make: readTab },
  { id: 'write', label: 'Write', make: writeTab },
  { id: 'offline', label: 'Offline write', make: offlineTab },
  { id: 'carry', label: 'Carry', make: carryTab },
  { id: 'verify', label: 'Verify copy', make: verifyTab },
  { id: 'relays', label: 'Relays', make: relaysTab },
]

const views = new Map<string, HTMLElement>()
const main = h('main', { id: 'workspace', tabindex: -1 })
const nav = h('nav', { class: 'tabs', 'aria-label': 'Workspace' })

function show(id: string) {
  const tab = tabs.find((t) => t.id === id) ?? tabs[0]
  if (!views.has(tab.id)) views.set(tab.id, tab.make())
  main.replaceChildren(views.get(tab.id)!)
  for (const b of nav.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.id === tab.id)
    b.setAttribute('aria-current', b.dataset.id === tab.id ? 'page' : 'false')
  }
  if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`)
}

for (const t of tabs) {
  const b = h('button', { 'data-id': t.id }, t.label)
  b.addEventListener('click', () => show(t.id))
  nav.append(b)
}

function connectionPanel(): HTMLElement {
  const s = settings.get()
  const mode = h(
    'select',
    {},
    h('option', { value: 'tunnel', selected: s.mode === 'tunnel' }, 'Tunnel (relays + quorum)'),
    h('option', { value: 'direct', selected: s.mode === 'direct' }, 'Direct Arkiv RPC (no Tunnel)'),
  )
  const relays = h('textarea', { rows: 3, class: 'mono small' }, s.relays.join('\n'))
  const liar = h('input', { type: 'checkbox', checked: s.includeLiar, disabled: !LIAR_RELAY })
  const summary = h('summary')
  const renderSummary = () => {
    const cur = settings.get()
    summary.textContent = cur.mode === 'direct' ? 'Connection: direct RPC' : `Connection: ${activeRelays().length} relays${cur.includeLiar ? ' (incl. a lying one)' : ''}`
  }
  const save = () => {
    settings.set({
      mode: mode.value as 'tunnel' | 'direct',
      relays: relays.value.split(/\s+/).map((r) => r.trim()).filter(Boolean),
      includeLiar: liar.checked,
    })
    renderSummary()
  }
  mode.addEventListener('change', save)
  relays.addEventListener('change', save)
  liar.addEventListener('change', save)
  renderSummary()
  onNetChange(renderSummary)
  return h(
    'details',
    { class: 'connection' },
    summary,
    h('label', {}, 'Mode', mode),
    h('label', {}, 'Relay URLs (one per line)', relays),
    h('label', { class: 'inline' }, liar, ' Add a deliberately lying relay (demo)', LIAR_RELAY ? '' : ' (not configured)'),
  )
}

document.querySelector('#app')!.replaceChildren(
  h('a', { class: 'skip-link', href: '#workspace' }, 'Skip to workspace'),
  h(
    'header',
    {},
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 't'),
      h('div', {}, h('h1', {}, 'Tunnel'), h('p', { class: 'tagline' }, 'An open path to Arkiv.')),
    ),
    connectionPanel(),
  ),
  h('div', { class: 'intro' },
    h('div', {},
      h('p', { class: 'eyebrow' }, 'THE PUBLIC NOTICE BOARD'),
      h('h2', {}, 'Stay connected. Even offline.'),
      h('p', { class: 'intro-copy' }, 'Read, share, and verify notices across network boundaries. Your keys stay with you, wherever your message goes.'),
    ),
    h('div', { class: 'intro-note' }, h('span', { class: 'network-label' }, 'Tiramisu testnet'), h('span', {}, 'Demo workspace'), h('small', {}, 'Synthetic notices only')),
  ),
  nav,
  main,
  h(
    'footer',
    {},
    'Tiramisu testnet · ',
    h('a', { href: 'https://github.com/CapThunder19/Tunnel', target: '_blank', rel: 'noopener' }, 'source (MIT)'),
    ' · ',
    h('a', { href: './verify.html' }, 'standalone offline verifier'),
    ' · ',
    h('a', { href: './examples/notices.tunnel', download: 'notices.tunnel' }, 'sample certified copy'),
  ),
)
show(location.hash.slice(1))
addEventListener('hashchange', () => {
  if (location.hash !== '#workspace') show(location.hash.slice(1))
})
