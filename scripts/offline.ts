/**
 * Offline write, end to end, as three separate processes:
 *
 *   npx tsx scripts/offline.ts fund 2          # online: create + fund 2 stamps -> stamps.local.json
 *   npx tsx scripts/offline.ts sign "text..."  # NO NETWORK NEEDED: sign with an unused stamp -> notice.tnl.txt
 *   npx tsx scripts/offline.ts carry           # anyone, online: decode, show author, broadcast via relays
 */
import { createPublicClient, createWalletClient, ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { str, u64 } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { broadcast, createStamps, encode, inspect, splitSms, tunnel, type Stamp } from '../packages/tunnel/src/index.js'
import { bigintJson, loadEnv, privateKey, relays } from './env.js'

const STAMPS = 'stamps.local.json'
const OUT = 'notice.tnl.txt'
const env = loadEnv()
const [cmd, arg] = process.argv.slice(2)

const loadStamps = (): Stamp[] => (existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, 'utf8')) : [])
const saveStamps = (s: Stamp[]) => writeFileSync(STAMPS, JSON.stringify(s, null, 2))

if (cmd === 'fund') {
  const wallet = createWalletClient({ chain: tiramisu, account: privateKeyToAccount(privateKey(env)), transport: tunnel(relays(env)) })
  const stamps = await createStamps(Number(arg ?? 1), wallet)
  saveStamps([...loadStamps(), ...stamps])
  for (const s of stamps) console.log('funded stamp', s.address, 'tx', s.fundingTx)
} else if (cmd === 'sign') {
  const { signOffline } = await import('../packages/tunnel/src/offline.js')
  const stamps = loadStamps()
  const stamp = stamps.find((s) => !s.used)
  if (!stamp) throw new Error('no unused stamp: run "fund" while online')
  const raw = await signOffline(stamp.privateKey, {
    expires: ExpirationTime.fromDays(90),
    payload: jsonToPayload({ text: arg ?? 'Signed offline, carried by someone else.', district: 'east' }),
    contentType: 'application/json',
    attributes: { app: str('tunnel-demo'), type: str('notice'), district: str('east'), ts: u64(BigInt(Math.floor(Date.now() / 1000))) },
    flags: { readonly: true },
  })
  stamp.used = true
  saveStamps(stamps)
  const text = await encode(raw)
  writeFileSync(OUT, text)
  console.log(`signed by stamp ${stamp.address} (funded by ${stamp.fundedBy}) with no network call`)
  console.log(`${text.length} chars -> ${OUT}; as SMS: ${splitSms(text).length} parts`)
} else if (cmd === 'carry') {
  const text = readFileSync(arg ?? OUT, 'utf8')
  const transport = tunnel(relays(env))
  const client = createPublicClient({ chain: tiramisu, transport })
  const { decode } = await import('../packages/tunnel/src/offline.js')
  const preview = await inspect(await decode(text))
  console.log('carrying a tx signed by', preview.author, '- max cost', formatEther(preview.maxCost), 'GLM')
  console.log('it writes:', bigintJson(preview.creates))
  const { hash, author } = await broadcast(text, client)
  const receipt = await client.waitForTransactionReceipt({ hash })
  console.log('broadcast', hash, receipt.status, 'block', receipt.blockNumber)
  const page = await client.select('*').where(eq('app', 'tunnel-demo'), eq('type', 'notice')).createdBy(author).limit(5).fetch()
  for (const e of page.entities) console.log('on chain:', e.key, '$creator', e.creator, e.toJson())
  console.log(`explorer: https://tiramisu.explorer.arkiv.network/tx/${hash}`)
} else {
  console.log('usage: offline.ts fund [n] | sign [text] | carry [file]')
}
