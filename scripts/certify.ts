/**
 * Make a certified copy of every demo notice, witnessed by 3 keys.
 *   npx tsx scripts/certify.ts [out=examples/notices.tunnel]
 *
 * Witness #1 is the main wallet; #2 and #3 are separate keys (witnesses.local.json, gitignored),
 * funded once from the main wallet. Each witness re-reads the snapshot block through its own relay
 * pair before signing.
 */
import { createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createPublicClient, parseEther, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { attest, makeBundle, takeSnapshot, tunnel, verifyOffline } from '../packages/tunnel/src/index.js'
import { loadEnv, privateKey, relays } from './env.js'

const out = process.argv[2] ?? 'examples/notices.tunnel'
const env = loadEnv()
const rs = relays(env)
const QUERY = `app = str('tunnel-demo') AND type = str('notice')`
const WITNESSES = 'witnesses.local.json'

const main = privateKey(env)
let extra: Hex[] = existsSync(WITNESSES) ? JSON.parse(readFileSync(WITNESSES, 'utf8')) : []
if (extra.length < 2) {
  extra = [generatePrivateKey(), generatePrivateKey()]
  writeFileSync(WITNESSES, JSON.stringify(extra))
  const funder = createWalletClient({ chain: tiramisu, account: privateKeyToAccount(main), transport: tunnel(rs) })
  for (const k of extra) {
    const hash = await funder.sendTransaction({ to: privateKeyToAccount(k).address, value: parseEther('0.01') })
    await funder.waitForTransactionReceipt({ hash })
    console.log('funded witness', privateKeyToAccount(k).address)
  }
}

const reader = createPublicClient({ chain: tiramisu, transport: tunnel(rs) })
const snapshot = await takeSnapshot(reader, QUERY)
console.log(`snapshot: ${snapshot.entities.length} notices at block ${snapshot.block} (${new Date(snapshot.blockTime * 1000).toISOString()}), hash ${snapshot.hash}`)

const keys = [main, ...extra]
const attestations = []
for (const [i, k] of keys.entries()) {
  // rotate relay order so witnesses do not all lean on the same relay first
  const mine = [...rs.slice(i % rs.length), ...rs.slice(0, i % rs.length)]
  const wallet = createWalletClient({ chain: tiramisu, account: privateKeyToAccount(k), transport: tunnel(mine) })
  const a = await attest(snapshot, wallet, createPublicClient({ chain: tiramisu, transport: tunnel(mine) }))
  console.log(`witness ${a.witness}: attestation entity ${a.entityKey} tx ${a.txHash}`)
  attestations.push(a)
}

const bundle = makeBundle(snapshot, attestations)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(bundle, null, 1))
const trusted = attestations.map((a) => a.witness)
const check = await verifyOffline(bundle, trusted)
console.log(`wrote ${out}: authentic=${check.authentic}, ${check.trustedCount}/${trusted.length} trusted witnesses`)
console.log('trusted witnesses:', JSON.stringify(trusted))
