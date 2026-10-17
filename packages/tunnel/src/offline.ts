import { createWalletClient, type CreateEntityParameters } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import {
  bytesToHex,
  custom,
  decodeAbiParameters,
  decodeFunctionData,
  hexToBigInt,
  hexToBytes,
  hexToString,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  parseGwei,
  parseTransaction,
  recoverTransactionAddress,
  sha256,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * A stamp is a fresh key, pre-funded while online with just enough GLM for one write. On a device
 * with no connection, the author signs a create with it; anyone can broadcast the result later,
 * and the entity's `$creator` is the stamp, never the carrier.
 *
 * Stamp keys are stored locally only: never on Arkiv, never committed.
 */
export interface Stamp {
  address: Address
  privateKey: Hex
  /** Address of the wallet that funded (and vouches for) this stamp. */
  fundedBy: Address
  fundingTx?: Hex
  createdAt: number
  used?: boolean
}

/** Gas limit for an offline create. A single create with a 1 KB payload stays well below this. */
export const STAMP_GAS = 600_000n
/** Fee caps for offline txs. Tiramisu's base fee is 1 gwei; the cap leaves room for spikes. */
export const STAMP_MAX_FEE = parseGwei('3')
export const STAMP_PRIORITY_FEE = parseGwei('0.001')
/** What one stamp holds: exactly enough for one tx at the fee cap. */
export const STAMP_VALUE = STAMP_GAS * STAMP_MAX_FEE

interface FundingWallet {
  account?: { address: Address } | undefined
  chain?: { id: number } | undefined
  sendTransaction: (args: any) => Promise<Hex>
  getTransactionCount: (args: { address: Address; blockTag?: 'pending' | 'latest' }) => Promise<number>
  waitForTransactionReceipt: (args: { hash: Hex }) => Promise<{ status: 'success' | 'reverted' }>
}

/**
 * Generate `n` stamp keys and fund each one from `funder` (online). Funding txs go out with
 * consecutive nonces and are awaited together.
 */
export async function createStamps(n: number, funder: FundingWallet, opts: { value?: bigint } = {}): Promise<Stamp[]> {
  const from = funder.account?.address
  if (!from) throw new Error('createStamps: funder needs an account')
  const start = await funder.getTransactionCount({ address: from, blockTag: 'pending' })
  const stamps: Stamp[] = Array.from({ length: n }, () => {
    const privateKey = generatePrivateKey()
    return { address: privateKeyToAccount(privateKey).address, privateKey, fundedBy: from, createdAt: Date.now() }
  })
  const hashes = await Promise.all(
    stamps.map((s, i) =>
      funder.sendTransaction({ account: funder.account, chain: funder.chain, to: s.address, value: opts.value ?? STAMP_VALUE, nonce: start + i }),
    ),
  )
  await Promise.all(
    hashes.map(async (hash, i) => {
      const r = await funder.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error(`funding stamp ${stamps[i].address} failed (${hash})`)
      stamps[i].fundingTx = hash
    }),
  )
  return stamps
}

/** Thrown inside the offline transport to stop viem right after it hands over the signed tx. */
class Captured extends Error {
  constructor(readonly rawTx: Hex) {
    super('captured')
  }
}

/** The SDK tried to reach the network during offline signing. */
export class OfflineNetworkCallError extends Error {
  constructor(readonly method: string) {
    super(`offline signing needed "${method}", which this device cannot answer without a network`)
    this.name = 'OfflineNetworkCallError'
  }
}

export interface SignOfflineOptions {
  chainId?: number
  /** Default 0: a fresh stamp's first and only tx. */
  nonce?: number
  gas?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

/**
 * Sign an Arkiv create with a stamp key, with no network at all.
 *
 * The real SDK builds the transaction, through a transport that answers locally:
 * - `eth_chainId` comes from `opts.chainId` (Tiramisu by default)
 * - `eth_blockNumber`: the SDK reads the head only to sanity-check the expiry. A relative expiry
 *   (`ExpirationTime.fromDays` / `fromBlocks`) goes on the wire as `minLifetime` blocks counted
 *   from the block the tx lands in, so the head is irrelevant. We answer `0x1`, and refuse absolute
 *   expiries (`atBlock` / `atDate`), which would need the real head.
 * - `eth_sendRawTransaction` is captured instead of sent
 * - anything else throws OfflineNetworkCallError (nonce, gas and fees are passed explicitly, so
 *   viem never asks)
 */
export async function signOffline(stampKey: Hex, params: CreateEntityParameters, opts: SignOfflineOptions = {}): Promise<Hex> {
  if (params.expires?.expiresAt !== 0n) {
    throw new Error('offline writes need a relative expiry (ExpirationTime.fromDays / fromBlocks): the device does not know the current block')
  }
  const chainId = opts.chainId ?? tiramisu.id
  const transport = custom(
    {
      async request({ method, params: p }) {
        switch (method) {
          case 'eth_chainId':
            return numberToHex(chainId)
          case 'eth_blockNumber':
            return '0x1'
          case 'eth_sendRawTransaction':
            throw new Captured(p[0])
          default:
            throw new OfflineNetworkCallError(method)
        }
      },
    },
    { retryCount: 0 },
  )
  const wallet = createWalletClient({ chain: { ...tiramisu, id: chainId }, account: privateKeyToAccount(stampKey), transport })
  try {
    await wallet.createEntity(params, {
      nonce: opts.nonce ?? 0,
      gas: opts.gas ?? STAMP_GAS,
      maxFeePerGas: opts.maxFeePerGas ?? STAMP_MAX_FEE,
      maxPriorityFeePerGas: opts.maxPriorityFeePerGas ?? STAMP_PRIORITY_FEE,
    })
  } catch (err) {
    let e: unknown = err
    for (let i = 0; e && i < 10; i++) {
      if (e instanceof Captured) return e.rawTx
      if (e instanceof OfflineNetworkCallError) throw e
      e = (e as { cause?: unknown }).cause
    }
    throw err
  }
  throw new Error('signOffline: the SDK finished without producing a transaction')
}

// ---------------------------------------------------------------------------------------------
// Compact text form: fits a QR code, a file, or a few SMS.
//
//   TNL1.<base64url(deflate-raw(raw tx bytes))>.<base64url(first 4 bytes of sha256(raw tx bytes))>
//
// ABI encoding is mostly zero padding, so deflate shrinks a typical notice ~4x (2347 -> ~515
// chars). Whitespace and line breaks are ignored on decode, so SMS parts can simply be pasted
// together.
// ---------------------------------------------------------------------------------------------

export const TEXT_PREFIX = 'TNL1'

function toB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export async function encode(rawTx: Hex): Promise<string> {
  const bytes = hexToBytes(rawTx)
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'))
  return `${TEXT_PREFIX}.${toB64url(packed)}.${toB64url(hexToBytes(sha256(bytes)).slice(0, 4))}`
}

export async function decode(text: string): Promise<Hex> {
  const compact = text.replace(/\s+/g, '')
  const parts = compact.split('.')
  if (parts.length !== 3 || parts[0] !== TEXT_PREFIX) throw new Error(`not a Tunnel transaction (expected "${TEXT_PREFIX}.…")`)
  let bytes: Uint8Array
  try {
    bytes = await pipe(fromB64url(parts[1]), new DecompressionStream('deflate-raw'))
  } catch {
    throw new Error('checksum mismatch: the text was damaged or truncated')
  }
  const check = toB64url(hexToBytes(sha256(bytes)).slice(0, 4))
  if (check !== parts[2]) throw new Error('checksum mismatch: the text was damaged or truncated')
  return bytesToHex(bytes)
}

/** Split encoded text into SMS-sized parts ("1/3 …"). Join them back in any order with `joinSms`. */
export function splitSms(encoded: string, size = 150): string[] {
  const body = size - 6
  const chunks = encoded.match(new RegExp(`.{1,${body}}`, 'g')) ?? []
  return chunks.map((c, i) => `${i + 1}/${chunks.length} ${c}`)
}

export function joinSms(parts: string[]): string {
  return parts
    .map((p) => p.trim().match(/^(\d+)\/(\d+)\s+(.*)$/s))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => m[3])
    .join('')
}

// ---------------------------------------------------------------------------------------------
// Inspect and broadcast (the carrier's side)
// ---------------------------------------------------------------------------------------------

export const ARKIV_ADDRESS: Address = '0x4400000000000000000000000000000000000044'
const EXECUTE_ABI = parseAbi(['function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)'])
const CREATE_PARAMS = parseAbiParameters(
  '(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, (bytes32 name, uint8 typeId, bytes value)[] attributes)',
)
const TYPE_NAMES: Record<number, string> = { 1: 'bool', 2: 'i32', 3: 'u64', 4: 'u256', 5: 'dec', 6: 'bytes32', 7: 'bytes', 8: 'str', 9: 'addr', 10: 'key' }

export interface InspectedCreate {
  minLifetimeBlocks: bigint
  expiresAt: bigint
  readonly: boolean
  permissionlessExtension: boolean
  attributes: Record<string, string | bigint | boolean>
  payloadText?: string
  contentType?: string
}

export interface InspectedTx {
  /** Recovered from the signature: this will be the entity's `$creator`. */
  author: Address
  hash: Hex
  chainId?: number
  nonce?: number
  to?: Address | null
  maxCost: bigint
  creates: InspectedCreate[]
}

function decodeAttrValue(typeId: number, value: Hex): string | bigint | boolean {
  switch (TYPE_NAMES[typeId]) {
    case 'str':
      return hexToString(value)
    case 'bool':
      return hexToBigInt(value) !== 0n
    case 'u64':
    case 'u256':
      return hexToBigInt(value)
    case 'addr':
      return ('0x' + value.slice(-40)) as Hex
    default:
      return value
  }
}

/** Everything a carrier should see before broadcasting: who signed it and what it writes. */
export async function inspect(rawTx: Hex): Promise<InspectedTx> {
  const tx = parseTransaction(rawTx)
  const author = await recoverTransactionAddress({ serializedTransaction: rawTx as any })
  const creates: InspectedCreate[] = []
  if (tx.to?.toLowerCase() === ARKIV_ADDRESS.toLowerCase() && tx.data) {
    const { args } = decodeFunctionData({ abi: EXECUTE_ABI, data: tx.data })
    for (const op of args[0]) {
      if (op.operation !== 1) continue
      const [c] = decodeAbiParameters(CREATE_PARAMS, op.operationData)
      const attributes: InspectedCreate['attributes'] = {}
      let payloadText: string | undefined
      let contentType: string | undefined
      for (const a of c.attributes) {
        const name = hexToString(a.name).replace(/\0+$/, '')
        if (name === '$payload') {
          try {
            payloadText = new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(a.value))
          } catch {
            payloadText = a.value
          }
        } else if (name === '$contentType') contentType = hexToString(a.value)
        else attributes[name] = decodeAttrValue(a.typeId, a.value)
      }
      creates.push({
        minLifetimeBlocks: c.minLifetime,
        expiresAt: c.expiresAt,
        readonly: (c.creationFlags & 1) !== 0,
        permissionlessExtension: (c.creationFlags & 2) !== 0,
        attributes,
        payloadText,
        contentType,
      })
    }
  }
  const maxFee = tx.maxFeePerGas ?? tx.gasPrice ?? 0n
  return {
    author,
    hash: keccak256(rawTx),
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    maxCost: (tx.gas ?? 0n) * maxFee + (tx.value ?? 0n),
    creates,
  }
}

/** Anything that can send a raw tx: a viem client on `tunnel()`, or a RelayPool. */
interface RawSender {
  request: (args: { method: 'eth_sendRawTransaction'; params: [Hex] }) => Promise<unknown>
}

/** Decode (text or hex), show who signed it, and send it through relays. */
export async function broadcast(input: string, via: RawSender): Promise<{ hash: Hex; author: Address; inspected: InspectedTx }> {
  const rawTx = input.trim().startsWith('0x') ? (input.trim() as Hex) : await decode(input)
  const inspected = await inspect(rawTx)
  const hash = (await via.request({ method: 'eth_sendRawTransaction', params: [rawTx] })) as Hex
  return { hash, author: inspected.author, inspected }
}

