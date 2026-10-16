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

---

## Tested paths that worked

| What | Expected | Result |
|---|---|---|
| SDK queries over a custom viem transport (`createTransport`) | `client.select('*').where(eq(...)).fetch()` sends exactly one `arkiv_query` with `[queryString, { select, atBlock?, limit?, cursor? }]` | As expected. The transport can inject `atBlock` (hex) when the caller did not set it, and the SDK decodes the result unchanged. Covered by `packages/tunnel/test/transport.test.ts`. |
| Historical read with `atBlock` (hex) on a narrow predicate, through 3 relays | Same canonical result from every honest relay at the same block | Worked: `$expiresAt > u64(head+1e6)`, `limit 3`, at block 662032 and 662036 returned identical hashes from two relays in under a second. A relay running with `--lie` produced a different hash and was out-voted. Reproduce with `scripts/smoke-read.ts`. |
| `eth_blockNumber` on the public RPC while `arkiv_query` was rate limited | works | Worked (`0xa1869`) |
