# Arkiv schema

Network: Tiramisu testnet, chain ID `7738577`. SDK `@arkiv-network/sdk` 0.8.1.
Everything below was checked against live entities on 2026-10-18 (block ~727,000).

Tunnel has two entity types. `notice` is the demo app's data. `attestation` belongs to the
library's certified-copy feature and works for any query, not only notices.

## Entity types

### `notice` (demo notice board)

| | |
|---|---|
| Written by | `createEntity` in [app/src/net.ts](../app/src/net.ts) (`noticeParams`), signed on the user's device and sent through relays; or signed **offline** with a stamp key ([packages/tunnel/src/offline.ts](../packages/tunnel/src/offline.ts)) and broadcast later by anyone |
| Expiration | `ExpirationTime.fromDays(90)`. On the wire this is `{ expiresAt: 0, minLifetime: 3,888,000 blocks }`, counted from the block the tx lands in, so a notice signed offline still gets 90 days from when it is carried |
| Flags | `readonly: true`: a posted notice can never be edited, by anyone |
| Payload | `application/json`, `{ "text": "<notice text, synthetic>" }`. Not queried, so it lives in the payload |
| `$creator` | The author: the device key, or the stamp that signed it offline. The relay or carrier that broadcast it never appears |

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `app` | `str` = `tunnel-demo` | Namespace for every query |
| `type` | `str` = `notice` | Entity type |
| `district` | `str` (`central`, `north`, `south`, `east`, `west`) | The Read tab filters by district |
| `ts` | `u64`, unix seconds | Numeric, so it can take range filters; the UI sorts on it client-side (no server-side ordering) |

### `attestation` (certified copies)

A witness re-reads a query at a pinned block, checks it gets the same canonical hash, signs it, and
records that here.

| | |
|---|---|
| Written by | `attest()` in [packages/tunnel/src/snapshot.ts](../packages/tunnel/src/snapshot.ts) |
| Expiration | `ExpirationTime.fromDays(30)`: a certified copy is evidence for a limited time |
| Flags | `readonly: true` (an attestation cannot be rewritten) and `permissionlessExtension: true` (anyone who relies on the copy can pay to keep the attestation alive past 30 days, without the witness) |
| Payload | `application/json`, `{ chainId, query, blockTime, signature }`: the EIP-191 signature over `tunnel:v1\|chainId\|block\|blockTime\|queryHash\|hash` |
| `$creator` | The witness. Verifiers match witnesses by `$creator`, never by a field anyone could write |

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `app` | `str` = `tunnel` | Namespace |
| `type` | `str` = `attestation` | Entity type |
| `block` | `u64` | The block the snapshot was pinned to. Numeric, so it can take ranges ("attestations since block N") |
| `queryhash` | `str`, `0x` sha256 | Which query was certified |
| `hash` | `str`, `0x` sha256 | The canonical result hash. This is the lookup key: "who attested to this exact content?" |

## Queries the app runs (exact strings, as `client.select(...).where(...).toString()` renders them)

Every query goes through `tunnel()`, which pins `atBlock` to (median relay head − 2), never
below the block of any receipt it has seen, and sends the identical query to 2 relays. If their
canonical hashes differ, it asks the remaining relays and goes with the strict majority.

| # | Where | Query | Options |
|---|---|---|---|
| Q1 | Read tab, all districts | `app = str('tunnel-demo') AND type = str('notice')` | `select: *`, `limit 100`, `atBlock` pinned |
| Q2 | Read tab, one district | `app = str('tunnel-demo') AND type = str('notice') AND district = str('east')` | same |
| Q3 | Verify tab (online extra) | `app = str('tunnel') AND type = str('attestation') AND hash = str('0x6b6d3383…a11812')` | `select: { key, creator, expiresAt }`, `limit 50` |
| Q4 | `scripts/smoke-write.ts`, `scripts/offline.ts` (read-back of one author's notices) | `app = str('tunnel-demo') AND type = str('notice') AND $creator = addr(0x455a064eB69b064124bcE89f677Ce89d50B92911)` | `select: *`, `limit 5` |
| Q5 | `takeSnapshot()` / `attest()` (certified copy) | Q1, read through every cursor page | `select: all fields`, `limit 200` per page, **same explicit `atBlock` on every page** |

Try them yourself (no backend of ours involved):

```sh
curl -s -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"arkiv_query\",\"params\":[\"app = str('tunnel') AND type = str('attestation') AND hash = str('0x6b6d33834557c48a9ec6f99e7d6c6304273212c5bf0e58382d1fec7b8fa11812')\",{\"select\":{\"key\":true,\"creator\":true}}]}"
```

This returns the 3 attestation entities for [examples/notices.tunnel](../examples/notices.tunnel), with
creators `0x455a…2911`, `0x1cE9…F3f0` and `0x699F…934a`.

## Deliberately kept off Arkiv

| What | Where it lives instead | Why |
|---|---|---|
| Private keys: device key, stamp keys, witness keys | The browser's localStorage, or `*.local.json` / `.env.local` (gitignored) | Rule and common sense. A stamp's *address* becomes `$creator`; its key never leaves the device |
| The certified copy itself (`.tunnel` file) | Travels as a file (USB stick, messaging, printout of the hash) | It has to work with no network. Arkiv stores only the witnesses' attestations, which are small and point at the hash |
| Offline-signed transactions waiting to be carried | QR / file / SMS text | Until someone broadcasts them they are just signed bytes; nothing to store |
| Relay operators' and users' IPs, request bodies | Nowhere: relays log nothing | Relays are only pipes |
| Arkiv Hub access key | Relay secrets (Cloudflare / Vercel env) | The docs say to keep it out of the browser; users never see it |
| Any real personal data | Nowhere | All notices are synthetic demo text |
