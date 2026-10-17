/**
 * Live smoke test: create one demo notice through relays, then read it back by quorum.
 *   npx tsx scripts/smoke-write.ts
 */
import { createPublicClient, createWalletClient, ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { str, u64 } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { privateKeyToAccount } from 'viem/accounts'
import { tunnel } from '../packages/tunnel/src/index.js'
import { bigintJson, loadEnv, privateKey, relays } from './env.js'

const env = loadEnv()
const account = privateKeyToAccount(privateKey(env))
const transport = tunnel(relays(env), { onEvent: (e) => e.type !== 'relay' && console.log('event:', bigintJson(e)) })
const wallet = createWalletClient({ chain: tiramisu, account, transport })
const client = createPublicClient({ chain: tiramisu, transport })

console.log('author', account.address, 'via', relays(env).join(', '))
const ts = BigInt(Math.floor(Date.now() / 1000))
const { entityKey, txHash, expiresAt } = await wallet.createEntity({
  expires: ExpirationTime.fromDays(90),
  payload: jsonToPayload({ text: 'Smoke test: notice written through Tunnel relays.', district: 'central' }),
  contentType: 'application/json',
  attributes: { app: str('tunnel-demo'), type: str('notice'), district: str('central'), ts: u64(ts) },
  flags: { readonly: true },
})
console.log({ entityKey, txHash, expiresAt })
console.log(`explorer: https://tiramisu.explorer.arkiv.network/tx/${txHash}`)

const page = await client
  .select('*')
  .where(eq('app', 'tunnel-demo'), eq('type', 'notice'))
  .createdBy(account.address)
  .limit(5)
  .fetch()
const mine = page.entities.find((e) => e.key === entityKey)
console.log('read back at block', page.blockNumber, '-> $creator', mine?.creator, mine?.toJson())
