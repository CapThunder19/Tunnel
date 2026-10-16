import { bytesToHex, sha256, stringToBytes, type Hex } from 'viem'

/**
 * Canonical form used for every hash Tunnel computes (quorum reads, snapshots, attestations).
 *
 * Rules, applied recursively:
 * - object keys sorted (UTF-16 code unit order), `undefined` values dropped
 * - bigint -> decimal string
 * - Uint8Array -> lowercase 0x hex
 * - strings that are 0x-hex -> lowercased (addresses and quantities compare case-insensitively)
 * - arrays keep their order, except the top-level entity list, which is sorted by `key`
 *
 * Hashes are always computed over the raw `arkiv_query` JSON-RPC entities, never over SDK-decoded
 * objects, so every relay and every verifier hashes the same representation.
 */
export function normalize(value: unknown): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'bigint':
      return value.toString(10)
    case 'string':
      return /^0x[0-9a-fA-F]*$/.test(value) ? value.toLowerCase() : value
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`cannot canonicalise non-finite number ${value}`)
      return value
    case 'boolean':
      return value
    case 'object': {
      if (value instanceof Uint8Array) return bytesToHex(value)
      if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)))
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(value as object).sort()) {
        const v = (value as Record<string, unknown>)[k]
        if (v !== undefined) out[k] = normalize(v)
      }
      return out
    }
    default:
      throw new Error(`cannot canonicalise ${typeof value}`)
  }
}

/** Stable JSON: same input always gives byte-identical output. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

const byName = (a: any, b: any) => (a?.name < b?.name ? -1 : a?.name > b?.name ? 1 : 0)

/**
 * One raw `arkiv_query` entity in canonical form: `attributes` and `attributeSchema` are arrays of
 * `{ name, ... }` whose order the node does not promise, so they are sorted by name.
 */
export function canonicalEntity(entity: unknown): unknown {
  const n = normalize(entity) as Record<string, unknown>
  if (n && typeof n === 'object' && !Array.isArray(n)) {
    for (const field of ['attributes', 'attributeSchema']) {
      if (Array.isArray(n[field])) n[field] = [...(n[field] as unknown[])].sort(byName)
    }
  }
  return n
}

/** Canonicalise and sort entities by key (falling back to their canonical text when no key was selected). */
export function sortEntities(entities: readonly unknown[]): unknown[] {
  const withSortKey = entities.map((e) => {
    const n = canonicalEntity(e) as Record<string, unknown>
    const key = typeof n?.key === 'string' ? n.key : JSON.stringify(n)
    return { n, key }
  })
  withSortKey.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return withSortKey.map((x) => x.n)
}

export function sha256Text(text: string): Hex {
  return sha256(stringToBytes(text))
}

/** Hash of a result set: sha256 of the canonical JSON of the key-sorted entity list. */
export function hashEntities(entities: readonly unknown[]): Hex {
  return sha256Text(canonicalJson(sortEntities(entities)))
}

/** Hash identifying a query: the query string plus the selection it projects. */
export function hashQuery(query: string, select: unknown): Hex {
  return sha256Text(canonicalJson({ query, select }))
}
