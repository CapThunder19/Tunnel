import './style.css'
import { h } from './dom'
import { verifyView } from './verify-ui'

document.querySelector('#app')!.replaceChildren(
  h('header', {}, h('div', {}, h('h1', {}, 'Tunnel verifier'), h('p', { class: 'tagline' }, 'Checks a certified copy of Arkiv data on this device. Works with no network; save this page and open it from disk.'))),
  h('main', {}, verifyView()),
  h('footer', {}, 'Single self-contained file · MIT · github.com/CapThunder19/Tunnel'),
)
