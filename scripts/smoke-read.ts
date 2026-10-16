/**
 * Live smoke test: one quorum read through relays against Tiramisu.
 *   npx tsx scripts/smoke-read.ts http://127.0.0.1:8787 http://127.0.0.1:8788 [http://127.0.0.1:8789]
 */
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { gt } from '@arkiv-network/sdk/query'
import { u64 } from '@arkiv-network/sdk/attr'
import { findTunnelError, RelayDisagreement, tunnel } from '../packages/tunnel/src/index.js'

const relays = process.argv.slice(2)
const transport = tunnel(relays, { onEvent: (e) => console.log('event:', e.type, JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) })
const client = createPublicClient({ chain: tiramisu, transport })

const head = await client.getBlockNumber()
try {
  const page = await client
    .select({ key: true, creator: true, expiresAt: true })
    .where(gt('$expiresAt', u64(head + 1_000_000n)))
    .limit(3)
    .fetch()
  console.log(`read at block ${page.blockNumber}: ${page.entities.length} entities`)
  for (const e of page.entities) console.log(' ', e.key, 'creator', e.creator)
} catch (err) {
  const d = findTunnelError(err, RelayDisagreement)
  if (d) console.log('DISAGREEMENT, no majority:', d.answers)
  else throw err
}
console.table(transport.pool.status().map(({ url, state, lastError }) => ({ url, state, lastError })))
