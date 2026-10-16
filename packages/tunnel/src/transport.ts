import { createTransport, keccak256, numberToHex, type Chain, type Hex, type Transport } from 'viem'
import { hashEntities } from './canonical.js'
import { NoHealthyRelayError, RelayDisagreement, RelayUnavailableError, RpcResponseError } from './errors.js'
import { rpcCall, type FetchLike } from './rpc.js'

export type RelayState = 'unknown' | 'ok' | 'down' | 'bad'

export interface RelayStatus {
  url: string
  state: RelayState
  /** While `down`, the relay is skipped until this time (ms since epoch). */
  downUntil?: number
  lastError?: string
  /** Hash the relay returned for the most recent quorum read it took part in. */
  lastHash?: Hex
}

export type TunnelEvent =
  | { type: 'read'; query: string; block: bigint; hash: Hex; agreed: string[] }
  | { type: 'disagreement'; query: string; block: bigint; answers: { relay: string; hash: Hex }[]; bad: string[] }
  | { type: 'write'; txHash: Hex; accepted: string[]; failed: { relay: string; error: string }[] }
  | { type: 'relay'; relay: string; state: RelayState; error?: string }

export interface TunnelOptions {
  /** How many relays must return the same answer for an `arkiv_query`. Default 2. */
  quorum?: number
  /** Blocks behind the relays' median head at which reads are pinned. Default 2. */
  pinMargin?: bigint
  /** How long a pinned block is reused for new queries (ms). Default 3000. */
  pinTtlMs?: number
  /** Per-request timeout (ms). Default 15000. */
  timeoutMs?: number
  /** Cooldown for a relay that failed with a network error and gave no Retry-After (ms). Default 15000. */
  downCooldownMs?: number
  /** Answer `eth_chainId` locally instead of trusting a relay. Defaults to the client's chain. */
  chainId?: number
  /** Headers sent to every relay. */
  headers?: Record<string, string>
  fetch?: FetchLike
  onEvent?: (event: TunnelEvent) => void
}

interface Answer {
  relay: string
  /** `${blockNumber}:${entitiesHash}` for results, `error:${code}` for JSON-RPC errors */
  compareKey: string
  hash: Hex
  result?: any
  error?: RpcResponseError
}

export class RelayPool {
  readonly relays: RelayStatus[]
  private readonly opts: TunnelOptions
  private readonly listeners = new Set<(e: TunnelEvent) => void>()
  private pinned?: { block: bigint; at: number }
  /** Cursors are bound to the block of the page that produced them. */
  private readonly cursorBlocks = new Map<string, bigint>()

  constructor(urls: string[], opts: TunnelOptions = {}) {
    if (urls.length === 0) throw new Error('tunnel() needs at least one relay URL')
    this.relays = [...new Set(urls)].map((url) => ({ url, state: 'unknown' }))
    this.opts = opts
    if (opts.onEvent) this.listeners.add(opts.onEvent)
  }

  get quorum(): number {
    return Math.max(1, this.opts.quorum ?? 2)
  }

  on(listener: (e: TunnelEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(): RelayStatus[] {
    return this.relays.map((r) => ({ ...r }))
  }

  /** Forget that relays were flagged bad or down. */
  reset(): void {
    for (const r of this.relays) {
      r.state = 'unknown'
      r.downUntil = undefined
      r.lastError = undefined
    }
  }

  private emit(e: TunnelEvent) {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch {
        // a listener must never break a request
      }
    }
  }

  private setState(r: RelayStatus, state: RelayState, error?: string) {
    if (r.state === 'bad' && state !== 'bad') return // bad is sticky until reset()
    const changed = r.state !== state || r.lastError !== error
    r.state = state
    r.lastError = error
    if (state === 'ok') r.downUntil = undefined
    if (changed) this.emit({ type: 'relay', relay: r.url, state, error })
  }

  private markDown(r: RelayStatus, err: RelayUnavailableError) {
    r.downUntil = Date.now() + (err.retryAfterMs ?? this.opts.downCooldownMs ?? 15_000)
    this.setState(r, 'down', err.message)
  }

  /** Relays worth trying, best first: ok, then unknown, then down ones whose cooldown expired. */
  usable(): RelayStatus[] {
    const now = Date.now()
    const rank = (r: RelayStatus) => (r.state === 'ok' ? 0 : r.state === 'unknown' ? 1 : 2)
    return this.relays
      .filter((r) => r.state !== 'bad' && !(r.state === 'down' && (r.downUntil ?? 0) > now))
      .sort((a, b) => rank(a) - rank(b))
  }

  private call(r: RelayStatus, method: string, params: unknown) {
    return rpcCall(r.url, method, params, {
      fetch: this.opts.fetch,
      timeoutMs: this.opts.timeoutMs,
      headers: this.opts.headers,
    })
  }

  async request(method: string, params: any, chain?: Chain): Promise<unknown> {
    if (method === 'eth_chainId') {
      const id = this.opts.chainId ?? chain?.id
      if (id !== undefined) return numberToHex(id)
    }
    if (method === 'eth_sendRawTransaction') return this.broadcast(params[0])
    if (method === 'arkiv_query') return this.quorumQuery(params)
    return this.single(method, params)
  }

  /** First relay that answers, rotating on network errors and 429s. */
  async single(method: string, params: unknown): Promise<unknown> {
    const failures: { relay: string; error: string }[] = []
    for (const r of this.usable()) {
      try {
        const result = await this.call(r, method, params)
        this.setState(r, 'ok')
        return result
      } catch (err) {
        if (err instanceof RpcResponseError) {
          this.setState(r, 'ok')
          throw err
        }
        const e = err as RelayUnavailableError
        this.markDown(r, e)
        failures.push({ relay: r.url, error: e.message })
      }
    }
    throw new NoHealthyRelayError(method, failures)
  }

  /**
   * Send a signed transaction to every relay at once. A relay cannot alter it (the signature
   * would break); the only thing it can do is drop it, so we need just one honest relay.
   */
  async broadcast(rawTx: Hex): Promise<Hex> {
    const expected = keccak256(rawTx)
    const targets = this.relays.filter((r) => r.state !== 'bad')
    const accepted: string[] = []
    const failed: { relay: string; error: string }[] = []
    let rejection: RpcResponseError | undefined

    await Promise.all(
      targets.map(async (r) => {
        try {
          const hash = (await this.call(r, 'eth_sendRawTransaction', [rawTx])) as Hex
          if (typeof hash !== 'string' || hash.toLowerCase() !== expected) {
            this.setState(r, 'bad', `returned tx hash ${hash}, expected ${expected}`)
            failed.push({ relay: r.url, error: 'wrong tx hash' })
            return
          }
          this.setState(r, 'ok')
          accepted.push(r.url)
        } catch (err) {
          if (err instanceof RpcResponseError) {
            this.setState(r, 'ok')
            // Another relay got there first: the node already has it.
            if (/already known|known transaction|nonce too low|already imported/i.test(err.message)) {
              accepted.push(r.url)
              return
            }
            rejection ??= err
            failed.push({ relay: r.url, error: err.message })
            return
          }
          this.markDown(r, err as RelayUnavailableError)
          failed.push({ relay: r.url, error: (err as Error).message })
        }
      }),
    )

    this.emit({ type: 'write', txHash: expected, accepted, failed })
    if (accepted.length > 0) return expected
    if (rejection) throw rejection
    throw new NoHealthyRelayError('eth_sendRawTransaction', failed)
  }

  /** Median head of up to three relays, minus a safety margin, cached briefly. */
  async pinBlock(): Promise<bigint> {
    const ttl = this.opts.pinTtlMs ?? 3000
    if (this.pinned && Date.now() - this.pinned.at < ttl) return this.pinned.block

    const heads: bigint[] = []
    const failures: { relay: string; error: string }[] = []
    const candidates = this.usable()
    let i = 0
    while (heads.length < Math.min(3, this.relays.length) && i < candidates.length) {
      const batch = candidates.slice(i, i + Math.min(3, this.relays.length) - heads.length)
      i += batch.length
      await Promise.all(
        batch.map(async (r) => {
          try {
            heads.push(BigInt((await this.call(r, 'eth_blockNumber', [])) as string))
            this.setState(r, 'ok')
          } catch (err) {
            if (err instanceof RelayUnavailableError) this.markDown(r, err)
            failures.push({ relay: r.url, error: (err as Error).message })
          }
        }),
      )
    }
    if (heads.length === 0) throw new NoHealthyRelayError('eth_blockNumber', failures)
    heads.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const median = heads[Math.floor((heads.length - 1) / 2)]
    const margin = this.opts.pinMargin ?? 2n
    const block = median > margin ? median - margin : median
    this.pinned = { block, at: Date.now() }
    return block
  }

  private async ask(r: RelayStatus, query: string, options: Record<string, unknown>): Promise<Answer | undefined> {
    try {
      const result: any = await this.call(r, 'arkiv_query', [query, options])
      if (!result || !Array.isArray(result.data)) {
        this.setState(r, 'bad', 'malformed arkiv_query result')
        return undefined
      }
      const hash = hashEntities(result.data)
      this.setState(r, 'ok')
      return { relay: r.url, compareKey: `${BigInt(result.blockNumber)}:${hash}`, hash, result }
    } catch (err) {
      if (err instanceof RpcResponseError) {
        this.setState(r, 'ok')
        const key = `error:${err.code}`
        return { relay: r.url, compareKey: key, hash: keccak256(new TextEncoder().encode(key)), error: err }
      }
      this.markDown(r, err as RelayUnavailableError)
      return undefined
    }
  }

  /**
   * Run the same `arkiv_query` at the same pinned block on `quorum` relays and compare canonical
   * hashes. On a mismatch, ask every remaining relay; the strict majority wins and the minority is
   * flagged `bad`. With no strict majority, throw RelayDisagreement.
   */
  async quorumQuery(params: any[]): Promise<unknown> {
    const query: string = params[0]
    const options: Record<string, unknown> = { ...(params[1] ?? {}) }
    if (options.atBlock === undefined) {
      const fromCursor = typeof options.cursor === 'string' ? this.cursorBlocks.get(options.cursor) : undefined
      options.atBlock = numberToHex(fromCursor ?? (await this.pinBlock()))
    }
    const block = BigInt(options.atBlock as string)

    const candidates = this.usable()
    const answers: Answer[] = []
    let next = 0
    const fill = async (target: number) => {
      while (answers.length < target && next < candidates.length) {
        const batch = candidates.slice(next, next + (target - answers.length))
        next += batch.length
        const got = await Promise.all(batch.map((r) => this.ask(r, query, options)))
        for (const a of got) if (a) answers.push(a)
      }
    }

    await fill(this.quorum)
    if (answers.length < this.quorum) {
      throw new NoHealthyRelayError(
        `arkiv_query (quorum ${this.quorum}, got ${answers.length})`,
        this.relays.filter((r) => r.state === 'down' || r.state === 'bad').map((r) => ({ relay: r.url, error: r.lastError ?? r.state })),
      )
    }

    let groups = groupAnswers(answers)
    if (groups.length > 1) {
      await fill(candidates.length) // ask everyone left to break the tie
      groups = groupAnswers(answers)
    }

    const [top] = groups
    const winner = top.length * 2 > answers.length ? top : undefined
    for (const a of answers) {
      const r = this.relays.find((x) => x.url === a.relay)!
      r.lastHash = a.hash
    }

    if (groups.length > 1) {
      const bad = winner ? answers.filter((a) => !winner.includes(a)).map((a) => a.relay) : []
      for (const url of bad) {
        this.setState(this.relays.find((r) => r.url === url)!, 'bad', `disagreed with quorum at block ${block}`)
      }
      const listed = answers.map((a) => ({ relay: a.relay, hash: a.hash }))
      this.emit({ type: 'disagreement', query, block, answers: listed, bad })
      if (!winner) throw new RelayDisagreement(query, block, listed)
    }

    const chosen = (winner ?? top)[0]
    if (chosen.error) throw chosen.error
    this.emit({ type: 'read', query, block, hash: chosen.hash, agreed: (winner ?? top).map((a) => a.relay) })
    if (typeof chosen.result.cursor === 'string') this.cursorBlocks.set(chosen.result.cursor, block)
    return chosen.result
  }
}

function groupAnswers(answers: Answer[]): Answer[][] {
  const map = new Map<string, Answer[]>()
  for (const a of answers) map.set(a.compareKey, [...(map.get(a.compareKey) ?? []), a])
  return [...map.values()].sort((a, b) => b.length - a.length)
}

export type TunnelTransport = Transport<'tunnel', { pool: RelayPool }> & { pool: RelayPool }

/**
 * A viem transport that reaches Arkiv through several untrusted relays.
 *
 * ```ts
 * const client = createPublicClient({ chain: tiramisu, transport: tunnel([relayA, relayB, relayC]) })
 * ```
 */
export function tunnel(relays: string[], opts: TunnelOptions = {}): TunnelTransport {
  const pool = new RelayPool(relays, opts)
  const transport = (({ chain } = {}) =>
    createTransport(
      {
        key: 'tunnel',
        name: 'Tunnel',
        type: 'tunnel',
        retryCount: 0,
        request: ({ method, params }) => pool.request(method, params, chain) as Promise<any>,
      },
      { pool },
    )) as TunnelTransport
  transport.pool = pool
  return transport
}
