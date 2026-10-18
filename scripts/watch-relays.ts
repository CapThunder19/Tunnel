/**
 * Watch relay lease renewals live over a WebSocket subscription (no polling).
 *   npx tsx scripts/watch-relays.ts [seconds=60]
 */
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { webSocket } from 'viem'
import { listRelays, tunnel } from '../packages/tunnel/src/index.js'

const OPERATORS = ['0x9Fb8276AA99d5778C7562E4A46A73536F3803164']
const reader = createPublicClient({ chain: tiramisu, transport: tunnel(['https://tunnel-relay.tunnel-relay.workers.dev', 'https://tunnel-app-three.vercel.app/api/rpc']) })
const relays = await listRelays(reader, OPERATORS)
console.log('watching leases of', relays.map((r) => r.url).join(', '))
const ws = createPublicClient({ chain: tiramisu, transport: webSocket('wss://rpc.tiramisu.db-chain.testnet.arkiv.network') })
let events = 0
const stop = ws.watchEntityEvents({
  onEvent: () => events++,
  onExpiryExtended: (e) => {
    const r = relays.find((x) => x.key === e.entityKey)
    if (r) console.log(`lease renewed live: ${r.url} -> expires at block ${e.expiresAt} (tx ${e.transactionHash})`)
  },
  onError: (e) => console.log('ws error', e.message),
})
setTimeout(() => {
  stop()
  console.log(`done: ${events} entity events received over the socket`)
  process.exit(0)
}, Number(process.argv[2] ?? 60) * 1000)
