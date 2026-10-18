# Friction report

Only issues we actually hit while building Tunnel, plus paths we tested that worked. Each entry
lists the surface, versions, steps to reproduce, expected vs actual, and a suggested fix.

Environment: `@arkiv-network/sdk` 0.8.1, `viem` 2.57.7, Node 24.19, Windows 11, Tiramisu testnet
(chain ID 7738577), October 2026.

---

## 1. Anonymous query budget: 429 with a non-JSON-RPC body

- **Surface:** public RPC gateway, `https://rpc.tiramisu.db-chain.testnet.arkiv.network`, method `arkiv_query`
- **Date hit:** 2026-10-16 (our first `arkiv_query` of the day from this IP)
- **Steps:**
  ```sh
  curl -s -i -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":2,"method":"arkiv_query","params":["$expiresAt > u64(0)",{"select":{"key":true},"limit":"0x1"}]}'
  ```
- **Expected:** a JSON-RPC 2.0 response. If rate limited, a JSON-RPC error object
  (`{"jsonrpc":"2.0","id":2,"error":{"code":...,"message":...}}`), so JSON-RPC clients surface it
  as an RPC error, plus a documented budget.
- **Actual:** `HTTP 429` with headers `ratelimit: limit=10000, remaining=0, reset=208` and
  `retry-after: 208`, and the body `{"error":"ANON_COST_LIMITED","message":"unauthenticated query
  budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}`. The body
  has no `jsonrpc`, `id` or `error.code`. `eth_blockNumber` still succeeded at the same moment, so
  the budget applies to `arkiv_query` only. Because the budget was already exhausted before our
  first query, it seems to be keyed by IP (or a shared egress), not by client.
- **Measured on 2026-10-18** (same `arkiv_query`, `limit 5`, `select {key}`): every response carries
  `arkiv-cost: 100`. Anonymous responses carried `ratelimit: limit=600, remaining=599, reset=60`,
  which works out to about **6 queries per minute per IP**. With an Access Key it was `limit=9999`
  plus `arkiv-quota-used-percent: 1`. A wrong key returns `401 {"error":"INVALID_KEY"}`, again not
  JSON-RPC shaped. So the anonymous limits differ between days (`10000/208s` on the 16th, `600/60s`
  on the 18th), and none of this is on the JSON-RPC docs page.
- **Impact on us:** a relay forwards every user's queries from one IP, so an anonymous relay
  drains the budget for all of its users. Our JSON-RPC client (`packages/tunnel/src/rpc.ts`) has
  to special-case this body shape, reads `Retry-After`, and marks the relay `down` until then, so
  the pool rotates to another relay.
- **What we did:** relays read an Arkiv Hub access key from a secret (`ARKIV_API_KEY`) and send it
  upstream as `X-API-KEY`, as the Access Keys docs page describes. This also follows that page's
  advice to keep the key out of the browser: users talk to relays, and only relays hold the key.
- **Suggested fix:** return a JSON-RPC error object (with the same code on every gateway) inside the
  429, and document the anonymous budget next to the RPC URL in the JSON-RPC docs: what one query
  costs against `limit=10000`, the window length, and whether `eth_*` calls count against it. The
  JSON-RPC "Querying data" page shows only the bare URL, and the key mechanism is documented on
  a separate Access Keys page.

## 2. Unfunded wallet: "Execution error without revert data", with no mention of the balance

- **Surface:** TypeScript SDK `createEntity` (wallet client) -> node `eth_estimateGas`
- **Versions:** `@arkiv-network/sdk` 0.8.1, viem 2.57.7, Tiramisu, 2026-10-18
- **Steps:** create a fresh key with zero GLM, then
  ```ts
  const wallet = createWalletClient({ chain: tiramisu, account, transport: http() }) // we used tunnel([...]); same result
  await wallet.createEntity({ expires: ExpirationTime.fromDays(90), payload: jsonToPayload({ text: 'x' }),
    contentType: 'application/json', attributes: { app: str('tunnel-demo') }, flags: { readonly: true } })
  ```
  (`scripts/smoke-write.ts` against an unfunded `PRIVATE_KEY`)
- **Expected:** an error that says the account has no balance to pay for gas (`insufficient funds`).
- **Actual:** the top-level error is `EntityMutationError: Transaction failed: Execution error without
  revert data`. Four `cause` levels down, the node's message is `out of gas: gas required exceeds: 0`.
  Neither mentions the balance. With a funded key, the same call (same params, same relays) succeeded
  (tx `0x2c2d9d1f…`, 101,552 gas), which confirms the "out of gas" was the zero balance capping the
  gas estimate at 0.
- **Suggested fix:** in `sendArkivTransaction`, when the estimate fails, check
  `getBalance(account)` and throw `InsufficientFundsError` with a faucet link if it is 0. Or forward
  the inner `details` instead of replacing it with "Execution error without revert data".

---

## Tested paths that worked

| What | Expected | Result |
|---|---|---|
| SDK queries over a custom viem transport (`createTransport`) | `client.select('*').where(eq(...)).fetch()` sends exactly one `arkiv_query` with `[queryString, { select, atBlock?, limit?, cursor? }]` | As expected. The transport can inject `atBlock` (hex) when the caller did not set it, and the SDK decodes the result unchanged. Covered by `packages/tunnel/test/transport.test.ts`. |
| Historical read with `atBlock` (hex) on a narrow predicate, through 3 relays | Same canonical result from every honest relay at the same block | Worked: `$expiresAt > u64(head+1e6)`, `limit 3`, at block 662032 and 662036 returned identical hashes from two relays in under a second. A relay running with `--lie` produced a different hash and was out-voted. Reproduce with `scripts/smoke-read.ts`. |
| Offline signing with the SDK (`signOffline` in `packages/tunnel/src/offline.ts`) | `createEntity` can produce a signed tx through a transport with no network | Worked. With `txParams = { nonce, gas, maxFeePerGas, maxPriorityFeePerGas }`, `createEntity` makes exactly 3 RPC calls: `eth_blockNumber` (only to sanity-check the expiry), `eth_fillTransaction` (viem 2.57 tries it first and falls back when it errors), and `eth_sendRawTransaction`. Without txParams it also calls `eth_getTransactionCount`. The `eth_chainId` call is skipped because the chain is set. We answer `eth_blockNumber` locally with `0x1`, because `ExpirationTime.fromDays(n)` goes on the wire as `{ expiresAt: 0, minLifetime: n days in blocks }`, counted from the block the tx lands in. So an offline-signed notice lives the full n days from whenever it is carried. Absolute expiries (`atBlock`/`atDate`) would need the real head, so we refuse them offline. A nice property of the wire format; it deserves a line in the docs. |
| `eth_blockNumber` on the public RPC while `arkiv_query` was rate limited | works | Worked (`0xa1869`) |
