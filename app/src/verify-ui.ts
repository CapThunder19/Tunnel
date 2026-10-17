// Imports only the pure verifier (no Arkiv SDK), so verify.html stays small and fully offline.
import { BUNDLE_FORMAT, verifyOffline, type Bundle, type VerifyResult } from '../../packages/tunnel/src/verify'
import { hexToString } from 'viem'
import { h, short, store } from './dom'

/** The witnesses that signed the published example copy (see README, on-chain evidence). */
export const DEFAULT_TRUSTED = (
  import.meta.env.VITE_TRUSTED_WITNESSES ??
  '0x455a064eB69b064124bcE89f677Ce89d50B92911,0x1cE965551F79Cd92F5a1132746DdBEC9EFDcF3f0,0x699F9c5e20dE345256D5bF865078B9f5249d934a'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)

const trustedStore = store<string[]>('tunnel.trustedWitnesses', DEFAULT_TRUSTED)

export interface VerifyHooks {
  /** Optional online extra: look up the witnesses' attestation entities on Arkiv. */
  onVerified?: (bundle: Bundle, result: VerifyResult, el: HTMLElement) => void
}

export function verifyView(hooks: VerifyHooks = {}): HTMLElement {
  const trusted = h('textarea', { rows: 3, class: 'mono small' }, trustedStore.get().join('\n'))
  const file = h('input', { type: 'file', accept: '.tunnel,application/json' })
  const drop = h('div', { class: 'drop' }, 'Drop a .tunnel file here, or ', file)
  const result = h('div')
  let last: { name: string; text: string } | undefined

  trusted.addEventListener('change', () => {
    trustedStore.set(trusted.value.split(/\s+/).filter(Boolean))
    if (last) run(last.name, last.text)
  })

  async function run(name: string, text: string) {
    last = { name, text }
    let bundle: Bundle
    try {
      bundle = JSON.parse(text)
    } catch {
      return result.replaceChildren(banner(false, 'Not a certified copy', `${name} is not valid JSON.`))
    }
    if (bundle?.format !== BUNDLE_FORMAT) return result.replaceChildren(banner(false, 'Not a certified copy', `${name} has format ${String((bundle as any)?.format)}.`))
    const r = await verifyOffline(bundle, trusted.value.split(/\s+/).filter(Boolean))
    const age = ageText(r.blockTime)
    const title = r.authentic
      ? `Authentic · ${r.trustedCount}/${r.witnesses.length} trusted witnesses · block ${r.block} · ${age} old`
      : !r.contentIntact || !r.queryIntact
        ? 'Tampered: the contents do not match what was certified'
        : r.trustedCount === 0 && r.witnesses.length > 0 && r.witnesses.every((w) => !w.validSignature)
          ? 'Tampered: no witness signed this version'
          : `Not enough trusted witnesses (${r.trustedCount}/${r.required})`
    const details = h(
      'div',
      { class: 'card' },
      h('p', {}, `${r.entityCount} entities · block ${r.block} · ${r.blockTime ? new Date(r.blockTime * 1000).toUTCString() : '?'} · chain ${bundle.snapshot.chainId}`),
      h('p', { class: 'mono small' }, `query: ${bundle.snapshot.query}`),
      h('p', { class: 'mono small' }, `hash: ${bundle.snapshot.hash}`),
      h('h3', {}, 'Witnesses'),
      ...r.witnesses.map((w) =>
        h(
          'p',
          { class: 'small' },
          w.validSignature ? (w.trusted ? '✔ ' : '• ') : '✖ ',
          h('span', { class: 'mono' }, w.witness),
          w.validSignature ? (w.trusted ? ' trusted' : ' valid signature, not in your trusted list') : ' signature does not match this copy',
        ),
      ),
      r.problems.length ? h('ul', { class: 'small error' }, ...r.problems.map((p) => h('li', {}, p))) : null,
      h('h3', {}, 'Contents'),
      ...bundle.snapshot.entities.map(entityRow),
    )
    result.replaceChildren(banner(r.authentic, title, r.authentic ? 'Verified on this device with no network: contents hash, witness signatures and block time all match.' : ''), details)
    hooks.onVerified?.(bundle, r, details)
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (f) run(f.name, await f.text())
  })
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', async (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    const f = e.dataTransfer?.files?.[0]
    if (f) run(f.name, await f.text())
  })

  return h(
    'section',
    {},
    h('h2', {}, 'Verify a certified copy'),
    h(
      'p',
      { class: 'muted' },
      'A certified copy is a snapshot of an Arkiv query at one block, signed by witnesses who each re-read that block themselves. It travels as a file and is checked here with no network: change one byte and it turns red.',
    ),
    drop,
    result,
    h('details', {}, h('summary', { class: 'small' }, 'Trusted witnesses'), h('label', {}, 'Addresses you trust (one per line)', trusted)),
  )
}

function banner(ok: boolean, title: string, sub: string): HTMLElement {
  return h('div', { class: ok ? 'verdict ok' : 'verdict bad' }, h('strong', {}, (ok ? '✔ ' : '✖ ') + title), sub ? h('p', {}, sub) : null)
}

function ageText(blockTime: number): string {
  if (!blockTime) return '?'
  const s = Math.max(0, Date.now() / 1000 - blockTime)
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}

function entityRow(e: any): HTMLElement {
  const attrs: Record<string, unknown> = {}
  for (const a of e?.attributes ?? []) attrs[a.name] = a.value
  let text = ''
  try {
    const raw = typeof e?.payload === 'string' ? hexToString(e.payload) : ''
    try {
      const j = JSON.parse(raw)
      text = typeof j?.text === 'string' ? j.text : raw
    } catch {
      text = raw
    }
  } catch {
    text = String(e?.payload ?? '')
  }
  return h(
    'div',
    { class: 'notice' },
    h('p', {}, text || '(no payload)'),
    h('p', { class: 'meta' }, Object.entries(attrs).map(([k, v]) => `${k}=${String(v)}`).join(' · ')),
    h('p', { class: 'meta' }, '$creator ', h('span', { class: 'mono' }, short(String(e?.creator ?? '?'), 6)), ' · key ', h('span', { class: 'mono' }, short(String(e?.key ?? '?'), 6))),
  )
}
