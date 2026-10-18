/**
 * Relay registry from the command line.
 *   npx tsx scripts/registry.ts renew    # one lease round as the operator (what the Worker cron does hourly)
 *   npx tsx scripts/registry.ts list     # live relays, trusted by $creator
 *
 * The operator key lives in operator.local.json (gitignored), funded once from the main wallet.
 */
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEther, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { listRelays, renewLeases, tunnel } from '../packages/tunnel/src/index.js'
import { loadEnv, privateKey, relays } from './env.js'

const FILE = 'operator.local.json'
const ANNOUNCE = [
  { url: 'https://tunnel-relay.tunnel-relay.workers.dev', region: 'cloudflare' },
  { url: 'https://tunnel-app-three.vercel.app/api/rpc', region: 'vercel' },
  { url: 'https://tunnel-relay-liar.tunnel-relay.workers.dev', region: 'cloudflare' }, // unhealthy by design (lie: true): must be skipped
]
const env = loadEnv()
const rs = env.RELAYS?.includes('127.0.0.1') ? ANNOUNCE.slice(0, 2).map((r) => r.url) : relays(env)
const reader = createPublicClient({ chain: tiramisu, transport: tunnel(rs) })

let opKey: Hex
if (existsSync(FILE)) opKey = JSON.parse(readFileSync(FILE, 'utf8')).key
else {
  opKey = generatePrivateKey()
  writeFileSync(FILE, JSON.stringify({ key: opKey }))
  const main = createWalletClient({ chain: tiramisu, account: privateKeyToAccount(privateKey(env)), transport: tunnel(rs) })
  const hash = await main.sendTransaction({ to: privateKeyToAccount(opKey).address, value: parseEther('0.05') })
  await main.waitForTransactionReceipt({ hash })
  console.log('funded operator', privateKeyToAccount(opKey).address)
}
const operator = privateKeyToAccount(opKey)
console.log('operator', operator.address)

if (process.argv[2] === 'renew') {
  const wallet = createWalletClient({ chain: tiramisu, account: operator, transport: tunnel(rs) })
  const results = await renewLeases(Object.assign(wallet, { select: reader.select.bind(reader) }), ANNOUNCE)
  for (const r of results) console.log(r.action.padEnd(18), r.url, r.txHash ?? '')
}
const live = await listRelays(reader, [operator.address])
const head = await reader.getBlockNumber()
for (const r of live) console.log('live:', r.url, r.region, `lease ends in ~${Math.round(Number(r.expiresAt - head) * 2 / 60)} min`, r.key)
