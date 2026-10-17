import { formatEther } from 'viem'
import { errorText, h, short } from '../dom'
import { device, DISTRICTS, EXPLORER, noticeParams, publicClient, walletClient } from '../net'

export function writeTab(): HTMLElement {
  const me = device()
  const balance = h('span', { class: 'mono' }, '…')
  const text = h('textarea', { rows: 3, maxlength: 280, placeholder: 'e.g. Water point at the school is open 6–9 am.' })
  const district = h('select', {}, ...DISTRICTS.map((d) => h('option', { value: d }, d)))
  const button = h('button', { class: 'primary' }, 'Post through relays')
  const out = h('div')

  async function refreshBalance() {
    try {
      const wei = await publicClient().getBalance({ address: me.address })
      balance.textContent = `${Number(formatEther(wei)).toFixed(5)} GLM`
    } catch (err) {
      balance.textContent = `unknown (${errorText(err)})`
    }
  }

  button.addEventListener('click', async () => {
    if (!text.value.trim()) return
    button.disabled = true
    out.replaceChildren(h('p', { class: 'muted' }, 'Signing on this device, sending the raw transaction to every relay…'))
    try {
      const res = await walletClient().createEntity(noticeParams(text.value.trim(), district.value))
      out.replaceChildren(
        h(
          'div',
          { class: 'ok-box' },
          h('p', {}, '✔ Posted. The relays only forwarded a transaction signed here, so none of them could change it.'),
          h('p', {}, 'Entity key ', h('span', { class: 'mono' }, res.entityKey)),
          h('p', {}, 'Transaction ', h('a', { href: `${EXPLORER}/tx/${res.txHash}`, target: '_blank', rel: 'noopener', class: 'mono' }, short(res.txHash, 8))),
          h('p', {}, '$creator is your address: ', h('a', { href: `${EXPLORER}/address/${me.address}`, target: '_blank', rel: 'noopener', class: 'mono' }, me.address)),
        ),
      )
      text.value = ''
      refreshBalance()
    } catch (err) {
      out.replaceChildren(h('p', { class: 'error' }, errorText(err)))
    } finally {
      button.disabled = false
    }
  })

  refreshBalance()
  return h(
    'section',
    {},
    h('h2', {}, 'Write a notice'),
    h(
      'p',
      { class: 'muted' },
      'Your key never leaves this browser. The transaction is signed here and sent to all relays at once; it lands if any one of them is honest and reachable.',
    ),
    h(
      'div',
      { class: 'card' },
      h('p', {}, 'This device: ', h('a', { href: `${EXPLORER}/address/${me.address}`, target: '_blank', rel: 'noopener', class: 'mono' }, me.address)),
      h('p', {}, 'Balance: ', balance, ' ', h('button', { class: 'link', onclick: refreshBalance }, 'refresh')),
      h(
        'p',
        { class: 'muted small' },
        'Demo key stored in this browser (testnet only). Needs a little test GLM: paste the address into ',
        h('a', { href: 'https://hub.arkiv.network/faucet', target: '_blank', rel: 'noopener' }, 'the Arkiv faucet'),
        '. One notice costs about 0.0001 GLM.',
      ),
    ),
    h('label', {}, 'District', district),
    h('label', {}, 'Notice (synthetic data only)', text),
    button,
    out,
  )
}
