# Tunnel

> Arkiv access that works through firewalls and offline. A one-line change for developers; nothing to install for users.

**Live app:** https://tunnel-app-three.vercel.app · **Offline verifier:** https://tunnel-app-three.vercel.app/verify.html (save it, open it from disk) · **Sample certified copy:** [examples/notices.tunnel](examples/notices.tunnel)

Built for **Arkiv: Global Tour Stop (pre-Devcon 8)**. Tracks: **Censorship Resistance**, **Open Source**, **Security**. Network: Tiramisu testnet.

## The problem

Every censorship-resistant Arkiv app says "you can read the data from Arkiv without our backend".
That is not true for two groups of people:

1. **People whose network blocks the Arkiv RPC.** State firewalls, school and office networks and
   mobile carriers block by domain. Block `rpc.tiramisu.db-chain.testnet.arkiv.network` and every
   Arkiv app goes dark for them, however decentralised the data is.
2. **People who are offline.** During an internet shutdown, in a disaster zone, or with SMS-only
   phones, nobody can write to Arkiv or check that a copy of Arkiv data is genuine.

Tunnel makes Arkiv reachable in every network condition, and it never asks the user to trust the
intermediaries it uses.

| Condition | Write | Read |
|---|---|---|
| Internet works, Arkiv RPC blocked | Through **relays** on big platforms that are costly to block (Cloudflare Workers, Vercel). The transaction is signed on the user's device; the relay only forwards it and **cannot alter it**. It goes to all relays at once, so one honest, reachable relay is enough. | The same query is sent to several relays **at the same pinned block** (`atBlock`), and their canonical result hashes are compared. A relay that disagrees with the majority is flagged and dropped. |
| Offline / SMS only | Sign on the device with a pre-funded **stamp** key and export it as a QR code, a file or ~4 SMS. Anyone (a **carrier**) can broadcast it later. `$creator` is the author, never the carrier. | A **certified copy**: a snapshot file plus witness signatures, verified fully offline by a single HTML file. Change one byte and it turns red. |

### Why not a VPN?

- A VPN needs every user to install something, and VPN apps and protocols are themselves blocked
  or criminalised in several countries.
- A VPN does nothing offline.
- Tunnel is a **one-line change for the developer**: swap the transport, and every user of that app
  gets it automatically, in a normal browser tab. Its offline paths work with no connection at all.

## For developers: the one-line switch

```ts
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { tunnel } from 'arkiv-tunnel' // packages/tunnel

const relays = ['https://tunnel-relay.tunnel-relay.workers.dev', 'https://tunnel-app-three.vercel.app/api/rpc']

// before: transport: http()
const client = createPublicClient({ chain: tiramisu, transport: tunnel(relays) })
const wallet = createWalletClient({ chain: tiramisu, account, transport: tunnel(relays) })

// unchanged SDK code: quorum read at a pinned block, write broadcast to every relay
await client.select('*').where(eq('type', 'notice')).fetch()
await wallet.createEntity({ ... })
```

The rest of the library:

| Function | What it does |
|---|---|
| `tunnel(relays, { quorum = 2 })` | viem transport. `arkiv_query`: pins a block, asks `quorum` relays, compares sha256 hashes of the canonical results, and on a mismatch asks the rest and goes with the strict majority (or throws `RelayDisagreement`). `eth_sendRawTransaction`: sends to all relays in parallel and flags any relay that returns a wrong tx hash. Rotates on network errors and 429 (`Retry-After`). Never pins below a block it has seen a receipt for (read-your-writes). `eth_chainId` is answered locally. |
| `createStamps(n, wallet)` | Generates and funds one-shot stamp keys while online. |
| `signOffline(stampKey, createParams)` | The real SDK `createEntity`, run through a transport that never touches the network. The test checks `fetch` is never called. |
| `encode` / `decode` / `splitSms` / `joinSms` | `TNL1.<deflated base64url tx>.<checksum>`, about 530 characters for a notice (a QR code or 4 SMS). Damage is detected. |
| `inspect(rawTx)` / `broadcast(text, client)` | For the carrier: recover the author (`$creator`-to-be), decode what it writes, send it. |
| `takeSnapshot(client, query)` | Every page of a query at one block, plus the block time and canonical hash. |
| `attest(snapshot, wallet, reader)` | Re-read independently, refuse if the hash differs, sign (EIP-191), and write an `attestation` entity. |
| `verifyOffline(bundle, trusted)` | Pure function: recompute the hash, check the signatures, count trusted witnesses. |

## Architecture

```
                         ┌───────────────────────── user's device ─────────────────────────┐
                         │  app / any Arkiv dApp                                           │
                         │    └─ Arkiv SDK ── tunnel() transport                           │
                         │         keys + signing stay here                                │
                         └──────────┬───────────────────┬──────────────────┬───────────────┘
              same raw tx / same    │                   │                  │
              query @ block N       ▼                   ▼                  ▼
                         Cloudflare Worker      Vercel Edge fn       (any relay you run)
                          relay (stateless,     relay (same core)     e.g. relay/src/node.ts
                          allowlist, no logs)
                                    └───────────────────┼──────────────────┘
                                                        ▼
                                          Arkiv node (Tiramisu) ◄── Arkiv Hub key lives in relays only

  answers compared: canonical sha256 of entities @ block N ── majority wins, minority flagged "bad"

  OFFLINE                                    CERTIFIED COPY
  stamp key ─ signOffline() ─ QR/file/SMS    takeSnapshot(@N) ─► witnesses each re-read @N,
       └─ carrier ─ broadcast() ─ relays          sign, write `attestation` entity on Arkiv
          ($creator = stamp, not carrier)    .tunnel file ─► verify.html (no network) ─► ✔ / ✖
```

## Try it (judges: nothing to install)

1. **Read:** open the [app](https://tunnel-app-three.vercel.app), Read tab → *Load notices*.
   The relay table shows both relays agreeing on one hash at one block.
2. **Lying relay:** open *Connection* (top right) → tick *Add a deliberately lying relay* →
   *Load notices* again. The liar is flagged `disagree` and the honest data is still shown.
3. **Verify a certified copy:** download the [sample](https://tunnel-app-three.vercel.app/examples/notices.tunnel)
   and drop it on the *Verify copy* tab or on the [standalone verifier](https://tunnel-app-three.vercel.app/verify.html)
   (works from disk, with Wi-Fi off). Then change one character inside a `payload` in the file and drop it again: red.
4. **Write and offline write:** the Write tab shows this browser's demo address. Send it a little
   test GLM from the [faucet](https://hub.arkiv.network/faucet) (about 0.01 is plenty), then post a notice.
   In *Offline write*, fund a stamp, **turn Wi-Fi off**, sign a notice, then turn Wi-Fi on, paste the
   text into *Carry* and broadcast. On the explorer, `$creator` is the stamp.

## Why Arkiv

Tunnel depends on three Arkiv properties. Without them it falls apart:

| Arkiv property | What Tunnel builds on it | What breaks without it |
|---|---|---|
| `$creator` is set by the chain from the transaction signature and can never change | An offline-signed notice keeps its author whoever carries it, and verifiers trust attestations by `$creator`. A relay or carrier has no way to put its own name on someone else's data. | **Postgres / our own API:** authorship is whatever the server writes into a column, so the operator (or anyone who compromises it) can forge or reassign it. Offline submissions would need the server to vouch for them. |
| **Queryable state at an exact block** (`arkiv_query` with `atBlock`) | Quorum reads: independent relays answer *the same question about the same state*, so honest answers are byte-identical after canonicalisation and a liar stands out. Certified copies name a block that any witness or judge can re-query later to reproduce the hash. | **Our own API / a subgraph:** there is no shared, pinned view to compare against, so two honest servers can differ because they are at different heights, and you cannot tell a liar from a laggard. A subgraph is also one operator's indexer. **IPFS:** content addressing proves a file is unchanged, but it cannot answer queries ("all notices in the east district"), and it does not say who published or when. |
| Entity Expiration + Lifetime Extension + creation flags | Notices are `readonly` and live 90 days (signed offline, they still get 90 days from when they are carried, because the lifetime is relative to inclusion). Attestations are `readonly` + `permissionlessExtension` and live 30 days: nobody can rewrite one, but anyone relying on a certified copy can keep its attestations alive without asking the witness. | **Postgres:** "readonly" and "anyone may extend" are policies the operator can switch off. **IPFS:** pinning is not ownership, and unpinned data disappears silently. |

What deliberately stays **off** Arkiv: every private key (device, stamps, witnesses), the
certified-copy files themselves (they must travel offline), signed transactions waiting to be
carried, relay logs and IPs (relays keep none), the Hub access key (relay secrets only), and any
real personal data (all demo notices are synthetic). Details: [arkiv/schema.md](arkiv/schema.md).

## Honest limits

- **Full shutdown with no carrier is out of scope.** Offline writes need *someone*, eventually, with
  a connection. Certified copies can be verified offline, but they are only as fresh as their block.
- **Relay domains can be blocked too.** The defence is many relays on platforms that are costly to
  block (blocking `*.workers.dev` or `*.vercel.app` breaks a large part of the web) and anyone being able
  to run one (one file, one command). This repo does not yet include a relay registry; relay URLs are configured.
- **Relays see users' IPs** (and the Arkiv node sees the relays'). Relays log nothing, but you
  have to trust that. Use several, run your own, or put Tor in front.
- **Quorum assumes an honest majority among the relays you ask.** If all of them collude, they can
  lie consistently. With 2 relays and no third to break a tie, Tunnel refuses to show anything rather than guess.
- **Stamps cost a little GLM each** (~0.0018 at most) and are single use. A stamp is a fresh
  address, so linking it to a real author is up to the app. In the demo, the main wallet's funding tx links them.
- **Demo keys live in browser storage** (testnet only).

## Repository layout

| Path | What |
|---|---|
| [packages/tunnel](packages/tunnel) (`arkiv-tunnel`) | Core library: [transport.ts](packages/tunnel/src/transport.ts), [canonical.ts](packages/tunnel/src/canonical.ts), [offline.ts](packages/tunnel/src/offline.ts), [snapshot.ts](packages/tunnel/src/snapshot.ts), [verify.ts](packages/tunnel/src/verify.ts) |
| [relay/](relay) | Stateless relay: [core.ts](relay/src/core.ts) shared by the [Cloudflare Worker](relay/src/worker.ts), the [Node server](relay/src/node.ts) and the [Vercel Edge function](api/rpc.ts) |
| [app/](app) | Demo notice board (Vite + TypeScript, static): Read, Write, Offline write, Carry, Verify copy |
| [scripts/](scripts) | Live end-to-end scripts (write, offline, certify, verify) |
| [arkiv/](arkiv) | [schema.md](arkiv/schema.md), [friction.md](arkiv/friction.md) |
| [docs/](docs) | [demo.md](docs/demo.md) (video script), [submission.md](docs/submission.md) |

## Setup

Requires Node 20+.

```sh
npm install
cp .env.example .env.local          # PRIVATE_KEY = a funded Tiramisu key; ARKIV_API_KEY optional
npm test                            # 34 tests: library + relay
npm run typecheck

# three local relays (one lies), then the app on http://localhost:5173
npx tsx relay/src/node.ts --port 8787 --name local-a
npx tsx relay/src/node.ts --port 8788 --name local-b
npx tsx relay/src/node.ts --port 8789 --name liar --lie   # DEMO ONLY
npm run dev -w tunnel-app

npm run build -w tunnel-app         # app/dist + single-file app/dist/verify.html
```

## Relays

A relay is a ~100-line stateless JSON-RPC forwarder ([relay/src/core.ts](relay/src/core.ts)). It:
- forwards only `eth_*` (minus signing/account methods), `arkiv_*`, `net_version` and `web3_clientVersion`
- sends CORS headers, serves `GET /health`, and passes `429` + `Retry-After` through
- logs no IPs and no bodies
- holds the Arkiv Hub access key (`ARKIV_API_KEY`, sent upstream as `X-API-KEY`), so browsers never see it

It cannot forge writes (transactions are signed on the user's device) and cannot forge reads
without being caught (clients compare several relays at the same pinned block).

### Deployed relays

| Relay | Platform | Health |
|---|---|---|
| `https://tunnel-relay.tunnel-relay.workers.dev` | Cloudflare Workers | [/health](https://tunnel-relay.tunnel-relay.workers.dev/health) |
| `https://tunnel-app-three.vercel.app/api/rpc` | Vercel Edge Function ([api/rpc.ts](api/rpc.ts)) | [GET /api/rpc](https://tunnel-app-three.vercel.app/api/rpc) |
| `https://tunnel-relay-liar.tunnel-relay.workers.dev` | Cloudflare Workers, **deliberately lying (`LIE=1`), demo only** | [/health](https://tunnel-relay-liar.tunnel-relay.workers.dev/health) |

### Run your own

Cloudflare Workers:

```sh
cd relay
npx wrangler login
npx wrangler secret put ARKIV_API_KEY     # optional, from https://hub.arkiv.network/api-keys
npx wrangler deploy                       # prints https://tunnel-relay.<you>.workers.dev
# demo liar (optional): npx wrangler deploy --name tunnel-relay-liar --var LIE:1
```

Vercel (app + relay): import the repo with the root directory set to the repo root (`vercel.json` sets the
build), and add the env var `ARKIV_API_KEY` (optional). The app is served from `app/dist` and the relay at `/api/rpc`.

Any machine: `npx tsx relay/src/node.ts --host 0.0.0.0 --port 8787`.

## On-chain evidence (Tiramisu, chain 7738577)

| Address | Role |
|---|---|
| `0x455a064eB69b064124bcE89f677Ce89d50B92911` | Main demo wallet: posts notices through relays, funds stamps, witness #1 |
| `0xC540e63E94fA1aB03B8d1A8dDd1FC2847a83D996` | Stamp #1 (funded by the main wallet): `$creator` of a notice signed offline |
| `0x7FA8B37b86170f6164EB2f6E4E80dfBf43D16153` | Stamp #2 (funded by the main wallet): `$creator` of a notice signed offline |
| `0x1cE965551F79Cd92F5a1132746DdBEC9EFDcF3f0` | Witness #2: writes `attestation` entities for certified copies |
| `0x699F9c5e20dE345256D5bF865078B9f5249d934a` | Witness #3: writes `attestation` entities for certified copies |

Browser demo keys generated in the live app (by you or by judges) also create `notice` entities.

| What | Transaction |
|---|---|
| Notice written through two relays | [`0x2c2d9d1f…`](https://tiramisu.explorer.arkiv.network/tx/0x2c2d9d1fcb7dd0e064089b9f5fdc7a5907215121dfaaf93f0c8943c0bacff35f) |
| Stamp funding | [`0xbc312384…`](https://tiramisu.explorer.arkiv.network/tx/0xbc31238434a220e780e152596276ac1c199ece3b8cbb6a82d87c6cea4e8bcd0f) |
| Notice signed offline by stamp #1, broadcast by a carrier | [`0xa92bfa72…`](https://tiramisu.explorer.arkiv.network/tx/0xa92bfa727ed132b7a019ea0592050af61cd8d932d7c2987b6d3d94bf3ee25078) |
| Notice signed offline by stamp #2, carried as 4-SMS text | [`0xdd789c71…`](https://tiramisu.explorer.arkiv.network/tx/0xdd789c71f7c08aac4459b6c54c10e7c91136ee724d9aa33a5f44519e1e04bc2c) |
| Attestation of [examples/notices.tunnel](examples/notices.tunnel) (block 708671) by the main wallet | [`0xea60869d…`](https://tiramisu.explorer.arkiv.network/tx/0xea60869d2b24b35f361e7db01d3b8c3611f8f575426a4840a6ba41628fd02b5f) |
| … by witness #2 | [`0x29c185a9…`](https://tiramisu.explorer.arkiv.network/tx/0x29c185a905c00795bc149d20e35c24eb5975bf8189f66c70b87683d41eb569c9) |
| … by witness #3 | [`0x52e3a781…`](https://tiramisu.explorer.arkiv.network/tx/0x52e3a781ba8f1653ef4c8faaec94aaf170327b35d00fef882b6b0cb44a1b8aac) |

Reproduce from the command line:

```sh
npx tsx scripts/smoke-read.ts <relayA> <relayB> [<liar>]   # quorum read; a liar gets flagged
npx tsx scripts/smoke-write.ts                 # write through relays, quorum read back, $creator = you
npx tsx scripts/offline.ts fund 1              # online: fund a stamp (key stays in stamps.local.json)
npx tsx scripts/offline.ts sign "your text"    # works with networking disabled
npx tsx scripts/offline.ts carry               # any machine: shows the author, broadcasts
npx tsx scripts/certify.ts                     # snapshot all notices; 3 witnesses re-read, sign, attest
npx tsx scripts/verify.ts examples/notices.tunnel   # offline check
```

## License

[MIT](LICENSE)
