import type { Hex } from 'viem'

/** The relay could not be reached, timed out, rate-limited us, or answered with garbage. */
export class RelayUnavailableError extends Error {
  readonly relay: string
  readonly status?: number
  readonly retryAfterMs?: number
  constructor(relay: string, message: string, opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
    super(`${relay}: ${message}`, { cause: opts.cause })
    this.name = 'RelayUnavailableError'
    this.relay = relay
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
  }
}

/**
 * The upstream node answered with a JSON-RPC error. This is a real answer (e.g. a rejected query
 * or a reverted transaction), not a relay failure, so it is not retried on other relays.
 * `code` and `data` are kept so the Arkiv SDK can still recognise its own error kinds.
 */
export class RpcResponseError extends Error {
  readonly code: number
  readonly data?: unknown
  readonly relay: string
  constructor(relay: string, code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcResponseError'
    this.code = code
    this.data = data
    this.relay = relay
  }
}

export interface RelayAnswer {
  relay: string
  hash: Hex
}

/** Relays returned different results for the same query at the same block. */
export class RelayDisagreement extends Error {
  readonly block: bigint
  readonly query: string
  readonly answers: RelayAnswer[]
  constructor(query: string, block: bigint, answers: RelayAnswer[]) {
    super(
      `relays disagree on "${query}" at block ${block}: ` +
        answers.map((a) => `${a.relay}=${a.hash.slice(0, 10)}`).join(', '),
    )
    this.name = 'RelayDisagreement'
    this.block = block
    this.query = query
    this.answers = answers
  }
}

/** No relay could serve the request. */
export class NoHealthyRelayError extends Error {
  readonly failures: { relay: string; error: string }[]
  constructor(method: string, failures: { relay: string; error: string }[]) {
    super(`no relay could serve ${method}: ` + failures.map((f) => `${f.relay} (${f.error})`).join('; '))
    this.name = 'NoHealthyRelayError'
    this.failures = failures
  }
}

/**
 * viem wraps transport errors (usually in `UnknownRpcError`), so the Tunnel error sits somewhere in
 * the `cause` chain. This digs it out.
 *
 * ```ts
 * try { await client.select('*').where(...).fetch() }
 * catch (e) { const d = findTunnelError(e, RelayDisagreement); if (d) showWarning(d.answers) }
 * ```
 */
export function findTunnelError<T extends Error>(error: unknown, type: new (...args: any[]) => T): T | undefined {
  let current = error
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (current instanceof type) return current
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}
