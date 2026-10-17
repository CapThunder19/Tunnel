/**
 * Certified copies: taking a snapshot and attesting to it (online).
 */
import { ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { str, u64 } from '@arkiv-network/sdk/attr'
import { numberToHex, type Address, type Hex } from 'viem'
import { hashEntities, hashQuery } from './canonical.js'
import { attestationMessage, BUNDLE_FORMAT, type Attestation, type Bundle, type Snapshot } from './verify.js'

/** Every field `arkiv_query` can return. */
export const SELECT_ALL = {
  key: true,
  owner: true,
  creator: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
  creationFlags: true,
  contentType: true,
  payload: true,
  attributes: true,
} as const

interface Requester {
  request(args: { method: string; params?: unknown }): Promise<any>
}

/**
 * Read every page of `query` at one block and freeze it into a snapshot. Use a client on
 * `tunnel()` so the read itself is a quorum read.
 */
export async function takeSnapshot(
  client: Requester,
  query: string | { toString(): string },
  opts: { block?: bigint; select?: Record<string, unknown>; chainId?: number } = {},
): Promise<Snapshot> {
  const q = String(query)
  const select = opts.select ?? SELECT_ALL
  const chainId = opts.chainId ?? Number(await client.request({ method: 'eth_chainId' }))
  const block = opts.block ?? BigInt(await client.request({ method: 'eth_blockNumber' })) - 2n
  const entities: unknown[] = []
  let cursor: string | undefined
  do {
    const page = await client.request({
      method: 'arkiv_query',
      params: [q, { select, atBlock: numberToHex(block), limit: numberToHex(200), ...(cursor ? { cursor } : {}) }],
    })
    entities.push(...page.data)
    cursor = page.cursor
  } while (cursor)
  const header = await client.request({ method: 'eth_getBlockByNumber', params: [numberToHex(block), false] })
  return {
    chainId,
    query: q,
    select,
    block: block.toString(),
    blockTime: Number(BigInt(header.timestamp)),
    entities,
    queryHash: hashQuery(q, select),
    hash: hashEntities(entities),
  }
}

interface WitnessWallet {
  account?: { address: Address } | undefined
  signMessage: (args: { account?: any; message: string }) => Promise<Hex>
  createEntity: (params: any) => Promise<{ entityKey: Hex; txHash: Hex }>
}

/**
 * Witness a snapshot: independently re-run the query at the same block (through `reader`, ideally
 * different relays than the original), refuse if the hash differs, then sign it and record an
 * `attestation` entity on Arkiv.
 */
export async function attest(
  snapshot: Snapshot,
  wallet: WitnessWallet,
  reader: Requester,
  opts: { writeEntity?: boolean } = {},
): Promise<Attestation> {
  const again = await takeSnapshot(reader, snapshot.query, { block: BigInt(snapshot.block), select: snapshot.select, chainId: snapshot.chainId })
  if (again.hash !== snapshot.hash) throw new Error(`refusing to attest: re-reading block ${snapshot.block} gave ${again.hash}, the copy says ${snapshot.hash}`)
  if (again.blockTime !== snapshot.blockTime) throw new Error(`refusing to attest: block ${snapshot.block} time is ${again.blockTime}, the copy says ${snapshot.blockTime}`)
  const witness = wallet.account?.address
  if (!witness) throw new Error('attest: wallet needs an account')

  const signature = await wallet.signMessage({ account: wallet.account, message: attestationMessage(snapshot) })
  let entityKey: Hex | undefined
  let txHash: Hex | undefined
  if (opts.writeEntity !== false) {
    const res = await wallet.createEntity({
      expires: ExpirationTime.fromDays(30),
      payload: jsonToPayload({ chainId: snapshot.chainId, query: snapshot.query, blockTime: snapshot.blockTime, signature }),
      contentType: 'application/json',
      attributes: {
        app: str('tunnel'),
        type: str('attestation'),
        block: u64(BigInt(snapshot.block)),
        queryhash: str(snapshot.queryHash),
        hash: str(snapshot.hash),
      },
      // nobody can rewrite it, anyone can keep it alive
      flags: { readonly: true, permissionlessExtension: true },
    })
    entityKey = res.entityKey
    txHash = res.txHash
  }
  return { witness, signature, entityKey, txHash }
}

export function makeBundle(snapshot: Snapshot, attestations: Attestation[]): Bundle {
  return { format: BUNDLE_FORMAT, snapshot, attestations }
}
