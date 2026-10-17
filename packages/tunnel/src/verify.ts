/**
 * Certified copies: verification. Pure functions, no network, no Arkiv SDK import, so this file
 * can be bundled alone into a single offline HTML page.
 */
import { getAddress, recoverMessageAddress, type Address, type Hex } from 'viem'
import { hashEntities, hashQuery } from './canonical.js'

export const BUNDLE_FORMAT = 'tunnel-certified-copy/v1'

export interface Snapshot {
  chainId: number
  /** Arkiv query string, exactly as sent to `arkiv_query`. */
  query: string
  /** The `select` projection sent with it. */
  select: Record<string, unknown>
  /** Block the query was pinned to (decimal string). */
  block: string
  /** Unix seconds of that block, as reported by the relays it was read through. */
  blockTime: number
  /** Raw `arkiv_query` entities, every page. */
  entities: unknown[]
  queryHash: Hex
  /** sha256 of the canonical, key-sorted entity list. */
  hash: Hex
}

export interface Attestation {
  witness: Address
  /** EIP-191 personal_sign over `attestationMessage(snapshot)`. */
  signature: Hex
  /** The `attestation` entity the witness also wrote on Arkiv, if any. */
  entityKey?: Hex
  txHash?: Hex
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT
  snapshot: Snapshot
  attestations: Attestation[]
}

/** What a witness signs. Binds chain, block, block time, query and result. */
export function attestationMessage(s: Pick<Snapshot, 'chainId' | 'block' | 'blockTime' | 'queryHash' | 'hash'>): string {
  return `tunnel:v1|${s.chainId}|${s.block}|${s.blockTime}|${s.queryHash}|${s.hash}`
}

export interface WitnessResult {
  witness: Address
  validSignature: boolean
  trusted: boolean
  entityKey?: Hex
}

export interface VerifyResult {
  /** Contents match the hash, the hash matches what witnesses signed, and enough trusted witnesses signed. */
  authentic: boolean
  contentIntact: boolean
  queryIntact: boolean
  witnesses: WitnessResult[]
  trustedCount: number
  required: number
  block: string
  blockTime: number
  entityCount: number
  problems: string[]
}

/**
 * Verify a certified copy with no network: recompute the hash from the entities, check every
 * witness signature against it, count the witnesses that are in `trusted`.
 */
export async function verifyOffline(bundle: Bundle, trusted: string[], opts: { required?: number } = {}): Promise<VerifyResult> {
  const problems: string[] = []
  if (bundle?.format !== BUNDLE_FORMAT) problems.push(`unknown format ${String(bundle?.format)}`)
  const s = bundle?.snapshot
  if (!s || !Array.isArray(s.entities)) {
    return { authentic: false, contentIntact: false, queryIntact: false, witnesses: [], trustedCount: 0, required: opts.required ?? 1, block: '?', blockTime: 0, entityCount: 0, problems: [...problems, 'no snapshot in file'] }
  }

  const contentIntact = hashEntities(s.entities) === s.hash
  if (!contentIntact) problems.push('the entities do not match the certified hash: the copy was modified')
  const queryIntact = hashQuery(s.query, s.select) === s.queryHash
  if (!queryIntact) problems.push('the query does not match the certified query hash')

  const trustedSet = new Set(trusted.map((a) => a.toLowerCase()))
  const message = attestationMessage(s)
  const seen = new Set<string>()
  const witnesses: WitnessResult[] = []
  for (const a of bundle.attestations ?? []) {
    let valid = false
    try {
      const signer = await recoverMessageAddress({ message, signature: a.signature })
      valid = signer.toLowerCase() === a.witness.toLowerCase()
    } catch {
      valid = false
    }
    const witness = safeAddress(a.witness)
    if (!valid) problems.push(`signature from ${witness} does not match this copy`)
    const dup = seen.has(witness.toLowerCase())
    seen.add(witness.toLowerCase())
    // a witness vouches for the hash it signed; if the contents no longer match it, it vouches for nothing here
    const counts = valid && !dup && contentIntact && queryIntact && trustedSet.has(witness.toLowerCase())
    witnesses.push({ witness, validSignature: valid, trusted: counts, entityKey: a.entityKey })
  }

  const trustedCount = witnesses.filter((w) => w.trusted).length
  const required = opts.required ?? Math.max(1, Math.min(trustedSet.size, 2))
  if (trustedCount < required) problems.push(`only ${trustedCount} trusted witness signature(s), ${required} required`)

  return {
    authentic: contentIntact && queryIntact && trustedCount >= required,
    contentIntact,
    queryIntact,
    witnesses,
    trustedCount,
    required,
    block: s.block,
    blockTime: s.blockTime,
    entityCount: s.entities.length,
    problems,
  }
}

function safeAddress(a: string): Address {
  try {
    return getAddress(a)
  } catch {
    return a as Address
  }
}
