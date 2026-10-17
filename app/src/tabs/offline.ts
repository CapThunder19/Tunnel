import { createStamps, encode, signOffline, splitSms, STAMP_VALUE } from 'arkiv-tunnel'
import QRCode from 'qrcode'
import { formatEther } from 'viem'
import { errorText, h, short } from '../dom'
import { DISTRICTS, EXPLORER, noticeParams, stampStore, walletClient } from '../net'

export function offlineTab(): HTMLElement {
  const stampsBox = h('div')
  const fundOut = h('p', { class: 'muted' })
  const count = h('input', { type: 'number', min: 1, max: 10, value: 3 })
  const fundBtn = h('button', {}, 'Prepare stamps (online)')
  const text = h('textarea', { rows: 3, maxlength: 280, placeholder: 'Write with no connection. e.g. Clinic in the east district open until 8 pm.' })
  const district = h('select', {}, ...DISTRICTS.map((d) => h('option', { value: d }, d)))
  const signBtn = h('button', { class: 'primary' }, 'Sign offline')
  const online = h('span', { class: 'pill' })
  const out = h('div')

  const updateOnline = () => {
    online.textContent = navigator.onLine ? 'online' : 'offline: fine, signing needs no network'
    online.className = `pill ${navigator.onLine ? 'ok' : 'down'}`
  }
  addEventListener('online', updateOnline)
  addEventListener('offline', updateOnline)
  updateOnline()

  function renderStamps() {
    const stamps = stampStore.get()
    const unused = stamps.filter((s) => !s.used)
    stampsBox.replaceChildren(
      h('p', {}, `${unused.length} unused stamp(s) on this device`, stamps.length > unused.length ? ` · ${stamps.length - unused.length} used` : ''),
      ...stamps.map((s) =>
        h('div', { class: 'small mono' + (s.used ? ' muted' : '') }, `${s.used ? '✓ used' : '• ready'} ${short(s.address, 6)} funded by ${short(s.fundedBy, 4)}`),
      ),
    )
  }

  fundBtn.addEventListener('click', async () => {
    fundBtn.disabled = true
    fundOut.className = 'muted'
    fundOut.textContent = 'Funding stamps from this device’s wallet…'
    try {
      const stamps = await createStamps(Number(count.value) || 1, walletClient() as any)
      stampStore.set([...stampStore.get(), ...stamps])
      fundOut.textContent = `✔ Funded ${stamps.length} stamp(s), ${formatEther(STAMP_VALUE)} GLM each. Keys stay in this browser only.`
      renderStamps()
    } catch (err) {
      fundOut.className = 'error'
      fundOut.textContent = errorText(err)
    } finally {
      fundBtn.disabled = false
    }
  })

  signBtn.addEventListener('click', async () => {
    const stamps = stampStore.get()
    const stamp = stamps.find((s) => !s.used)
    if (!stamp) return out.replaceChildren(h('p', { class: 'error' }, 'No unused stamp. Prepare some while online.'))
    if (!text.value.trim()) return
    signBtn.disabled = true
    try {
      const raw = await signOffline(stamp.privateKey, noticeParams(text.value.trim(), district.value))
      stamp.used = true
      stampStore.set(stamps)
      renderStamps()
      const encoded = await encode(raw)
      const canvas = h('canvas')
      await QRCode.toCanvas(canvas, encoded, { errorCorrectionLevel: 'L', margin: 2, width: 320 })
      const file = URL.createObjectURL(new Blob([encoded], { type: 'text/plain' }))
      const sms = splitSms(encoded)
      out.replaceChildren(
        h(
          'div',
          { class: 'ok-box' },
          h('p', {}, `✔ Signed with stamp ${short(stamp.address, 6)}, with no network call. Anyone can carry this; the author stays ${short(stamp.address, 6)}.`),
          canvas,
          h('label', {}, `Text form (${encoded.length} characters)`, h('textarea', { rows: 4, readonly: true, class: 'mono small' }, encoded)),
          h(
            'div',
            { class: 'row' },
            h('button', { onclick: () => navigator.clipboard?.writeText(encoded) }, 'Copy text'),
            h('a', { href: file, download: `notice-${stamp.address.slice(2, 8)}.tnl.txt`, class: 'button' }, 'Download file'),
          ),
          h('details', {}, h('summary', {}, `As ${sms.length} SMS messages`), ...sms.map((p) => h('pre', { class: 'small' }, p))),
          h('p', { class: 'muted small' }, 'Once broadcast, the stamp shows up as $creator: ', h('a', { href: `${EXPLORER}/address/${stamp.address}`, target: '_blank', rel: 'noopener' }, 'explorer')),
        ),
      )
      text.value = ''
    } catch (err) {
      out.replaceChildren(h('p', { class: 'error' }, errorText(err)))
    } finally {
      signBtn.disabled = false
    }
  })

  renderStamps()
  return h(
    'section',
    {},
    h('h2', {}, 'Offline write'),
    h(
      'p',
      { class: 'muted' },
      'While online, fund a few one-shot “stamps” (fresh keys holding just enough GLM for one write). Later, with no connection at all, sign a notice with a stamp and hand it over as a QR code, a file or SMS text. Whoever broadcasts it cannot change it or claim it.',
    ),
    h('div', { class: 'card' }, h('h3', {}, '1. While online'), h('div', { class: 'row' }, count, fundBtn), fundOut, stampsBox),
    h('div', { class: 'card' }, h('h3', {}, '2. Anywhere, even in airplane mode ', online), h('label', {}, 'District', district), h('label', {}, 'Notice', text), signBtn),
    out,
  )
}
