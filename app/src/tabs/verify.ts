import { eq } from '@arkiv-network/sdk/query'
import { errorText, h, short } from '../dom'
import { EXPLORER, publicClient } from '../net'
import { verifyView } from '../verify-ui'

/** In the online app, the Verify tab also looks up the witnesses' attestation entities on Arkiv. */
export function verifyTab(): HTMLElement {
  return verifyView({
    onVerified(bundle, result, el) {
      const box = h('div', { class: 'small muted' }, 'Looking up attestation entities on Arkiv (optional, online)…')
      el.append(h('h3', {}, 'On Arkiv'), box)
      publicClient()
        .select({ key: true, creator: true, expiresAt: true })
        .where(eq('app', 'tunnel'), eq('type', 'attestation'), eq('hash', bundle.snapshot.hash))
        .limit(50)
        .fetch()
        .then((page) => {
          const signed = new Set(result.witnesses.filter((w) => w.validSignature).map((w) => w.witness.toLowerCase()))
          box.replaceChildren(
            h('p', {}, `${page.entities.length} attestation entities for this hash (matched by $creator, which nobody can forge):`),
            ...page.entities.map((e) =>
              h(
                'p',
                {},
                signed.has(String(e.creator).toLowerCase()) ? '✔ ' : '• ',
                h('a', { href: `${EXPLORER}/address/${e.creator}`, target: '_blank', rel: 'noopener', class: 'mono' }, short(String(e.creator), 6)),
                ` · entity ${short(String(e.key), 6)} · expires at block ${e.expiresAt}`,
              ),
            ),
          )
        })
        .catch((err) => box.replaceChildren(h('p', { class: 'muted' }, `Could not reach Arkiv (fine, the offline check above stands): ${errorText(err)}`)))
    },
  })
}
