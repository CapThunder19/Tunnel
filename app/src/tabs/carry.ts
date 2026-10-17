import { broadcast, decode, inspect, joinSms, type InspectedTx } from 'arkiv-tunnel'
import jsQR from 'jsqr'
import { formatEther } from 'viem'
import { errorText, h, short } from '../dom'
import { EXPLORER, publicClient } from '../net'

export function carryTab(): HTMLElement {
  const input = h('textarea', { rows: 5, class: 'mono small', placeholder: 'Paste TNL1.… text, or SMS parts ("1/4 …") in any order' })
  const file = h('input', { type: 'file', accept: '.txt,text/plain' })
  const scanBtn = h('button', {}, 'Scan QR with camera')
  const video = h('video', { playsinline: true, muted: true, class: 'hidden' })
  const preview = h('div')
  const out = h('div')
  let stopScan: (() => void) | undefined

  const normalise = (raw: string) => (/^\s*\d+\/\d+\s/.test(raw) ? joinSms(raw.split(/\n(?=\s*\d+\/\d+\s)/)) : raw)

  async function show() {
    out.replaceChildren()
    const raw = input.value.trim()
    if (!raw) return preview.replaceChildren()
    try {
      const tx = await inspect(await decode(normalise(raw)))
      preview.replaceChildren(describe(tx))
    } catch (err) {
      preview.replaceChildren(h('p', { class: 'error' }, errorText(err)))
    }
  }

  function describe(tx: InspectedTx): HTMLElement {
    const sendBtn = h('button', { class: 'primary' }, 'Broadcast through relays')
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true
      out.replaceChildren(h('p', { class: 'muted' }, 'Sending to every relay…'))
      try {
        const client = publicClient()
        const { hash } = await broadcast(normalise(input.value), client as any)
        const receipt = await client.waitForTransactionReceipt({ hash })
        out.replaceChildren(
          h(
            'div',
            { class: receipt.status === 'success' ? 'ok-box' : 'error' },
            h('p', {}, receipt.status === 'success' ? `✔ Included in block ${receipt.blockNumber}.` : 'Reverted.'),
            h('p', {}, 'Transaction ', h('a', { href: `${EXPLORER}/tx/${hash}`, target: '_blank', rel: 'noopener', class: 'mono' }, short(hash, 8))),
            h('p', {}, `$creator is ${tx.author}, not you: carrying gives you no authorship.`),
          ),
        )
      } catch (err) {
        const msg = errorText(err)
        out.replaceChildren(h('p', { class: 'error' }, /nonce too low|already known/i.test(msg) ? 'Already on chain: someone carried this before you.' : msg))
      } finally {
        sendBtn.disabled = false
      }
    })
    return h(
      'div',
      { class: 'card' },
      h('p', {}, 'Signed by (will be $creator): ', h('a', { href: `${EXPLORER}/address/${tx.author}`, target: '_blank', rel: 'noopener', class: 'mono' }, tx.author)),
      h('p', { class: 'muted small' }, `chain ${tx.chainId} · nonce ${tx.nonce} · costs the author at most ${formatEther(tx.maxCost)} GLM · tx ${short(tx.hash, 6)}`),
      ...tx.creates.map((c) =>
        h(
          'div',
          { class: 'notice' },
          h('p', {}, c.payloadText ? safeText(c.payloadText) : '(no payload)'),
          h(
            'p',
            { class: 'meta' },
            Object.entries(c.attributes)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(' · '),
            ` · lives ${Math.round(Number(c.minLifetimeBlocks) * 2 / 86400)} days from inclusion${c.readonly ? ' · readonly' : ''}`,
          ),
        ),
      ),
      sendBtn,
    )
  }

  input.addEventListener('input', show)
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (f) {
      input.value = await f.text()
      show()
    }
  })

  scanBtn.addEventListener('click', async () => {
    if (stopScan) return stopScan()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      video.srcObject = stream
      video.classList.remove('hidden')
      await video.play()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      let running = true
      stopScan = () => {
        running = false
        stream.getTracks().forEach((t) => t.stop())
        video.classList.add('hidden')
        scanBtn.textContent = 'Scan QR with camera'
        stopScan = undefined
      }
      scanBtn.textContent = 'Stop camera'
      const tick = () => {
        if (!running) return
        if (video.videoWidth) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
          if (code?.data.startsWith('TNL1.')) {
            input.value = code.data
            stopScan?.()
            show()
            return
          }
        }
        requestAnimationFrame(tick)
      }
      tick()
    } catch (err) {
      preview.replaceChildren(h('p', { class: 'error' }, `Camera unavailable: ${errorText(err)}`))
    }
  })

  return h(
    'section',
    {},
    h('h2', {}, 'Carry'),
    h(
      'p',
      { class: 'muted' },
      'Got a notice someone signed offline? Scan it, paste it or open the file. You will see exactly who signed it and what it says before you send it. You pay nothing: the stamp pays its own gas.',
    ),
    h('div', { class: 'row' }, scanBtn, file),
    video,
    input,
    preview,
    out,
  )
}

function safeText(json: string): string {
  try {
    const v = JSON.parse(json)
    return typeof v?.text === 'string' ? v.text : json
  } catch {
    return json
  }
}
