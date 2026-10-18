# Tunnel

> Arkiv access that works through firewalls and offline.

**Live app:** https://tunnel-app-three.vercel.app · **Offline verifier:** https://tunnel-app-three.vercel.app/verify.html (save it, open from disk) · **Sample certified copy:** [examples/notices.tunnel](examples/notices.tunnel)

Work in progress for **Arkiv: Global Tour Stop (pre-Devcon 8)**. Tracks: Censorship Resistance, Open Source, Security.

## Layout

| Path | What |
|---|---|
| `packages/tunnel` (npm: `arkiv-tunnel`) | Core library: quorum transport, offline signing, certified copies |
| `relay/` | Stateless JSON-RPC relay (Cloudflare Worker + Node) |
| `app/` | Demo notice board (Vite, static) |
| `arkiv/` | `schema.md`, `friction.md` |
| `docs/` | Demo script, submission drafts |

## Setup

```sh
npm install
cp .env.example .env.local   # add a funded Tiramisu key
```

## Relays

A relay is a ~100-line stateless JSON-RPC forwarder ([relay/src/core.ts](relay/src/core.ts)). It:
- forwards only `eth_*` (minus signing/account methods), `arkiv_*`, `net_version`, `web3_clientVersion`
- sends CORS headers, serves `GET /health`, passes `429` + `Retry-After` through
- logs no IPs and no bodies
- holds the Arkiv Hub access key (`ARKIV_API_KEY`, sent upstream as `X-API-KEY`) so browsers never see it

It cannot forge writes (transactions are signed on the user's device) and cannot forge reads
without being caught (clients compare several relays at the same pinned block).

### Deployed relays

| Relay | Platform | Health |
|---|---|---|
| `https://tunnel-relay.tunnel-relay.workers.dev` | Cloudflare Workers | [/health](https://tunnel-relay.tunnel-relay.workers.dev/health) |
| `https://tunnel-app-three.vercel.app/api/rpc` | Vercel Edge Function ([api/rpc.ts](api/rpc.ts)) | [GET /api/rpc](https://tunnel-app-three.vercel.app/api/rpc) |
| `https://tunnel-relay-liar.tunnel-relay.workers.dev` | Cloudflare Workers, **deliberately lying (`LIE=1`), demo only** | [/health](https://tunnel-relay-liar.tunnel-relay.workers.dev/health) |

### Run locally

```sh
npx tsx relay/src/node.ts --port 8787 --name local-a
npx tsx relay/src/node.ts --port 8788 --name local-b
npx tsx relay/src/node.ts --port 8789 --name liar --lie   # DEMO ONLY: tampers query results
npx tsx scripts/smoke-read.ts http://127.0.0.1:8789 http://127.0.0.1:8787 http://127.0.0.1:8788
```

### Deploy to Cloudflare Workers

```sh
cd relay
npx wrangler login
npx wrangler secret put ARKIV_API_KEY     # optional, from https://hub.arkiv.network/api-keys
npx wrangler deploy                       # prints https://tunnel-relay.<you>.workers.dev
# demo liar (optional): npx wrangler deploy --name tunnel-relay-liar --var LIE:1
```

### Deploy to Vercel (app + second relay)

Import the repo in Vercel (root directory = repo root; `vercel.json` sets the build), and add the
env var `ARKIV_API_KEY` (optional). The static app is served from `app/dist`, and the relay at `/api/rpc`.

## On-chain evidence (Tiramisu, chain 7738577)

| Address | Role |
|---|---|
| `0x455a064eB69b064124bcE89f677Ce89d50B92911` | Main demo wallet: posts notices through relays, funds stamps |
| `0xC540e63E94fA1aB03B8d1A8dDd1FC2847a83D996` | Stamp #1 (funded by the main wallet): `$creator` of a notice signed offline |
| `0x7FA8B37b86170f6164EB2f6E4E80dfBf43D16153` | Stamp #2 (funded by the main wallet): `$creator` of a notice signed offline |
| `0x1cE965551F79Cd92F5a1132746DdBEC9EFDcF3f0` | Witness #2: writes `attestation` entities for certified copies |
| `0x699F9c5e20dE345256D5bF865078B9f5249d934a` | Witness #3: writes `attestation` entities for certified copies |

| What | Transaction |
|---|---|
| Notice written through two relays | [`0x2c2d9d1f…`](https://tiramisu.explorer.arkiv.network/tx/0x2c2d9d1fcb7dd0e064089b9f5fdc7a5907215121dfaaf93f0c8943c0bacff35f) |
| Stamp funding | [`0xbc312384…`](https://tiramisu.explorer.arkiv.network/tx/0xbc31238434a220e780e152596276ac1c199ece3b8cbb6a82d87c6cea4e8bcd0f) |
| Notice signed offline by stamp #1, broadcast by a carrier | [`0xa92bfa72…`](https://tiramisu.explorer.arkiv.network/tx/0xa92bfa727ed132b7a019ea0592050af61cd8d932d7c2987b6d3d94bf3ee25078) |
| Attestation of [examples/notices.tunnel](examples/notices.tunnel) (block 708671) by the main wallet | [`0xea60869d…`](https://tiramisu.explorer.arkiv.network/tx/0xea60869d2b24b35f361e7db01d3b8c3611f8f575426a4840a6ba41628fd02b5f) |
| … by witness #2 | [`0x29c185a9…`](https://tiramisu.explorer.arkiv.network/tx/0x29c185a905c00795bc149d20e35c24eb5975bf8189f66c70b87683d41eb569c9) |
| … by witness #3 | [`0x52e3a781…`](https://tiramisu.explorer.arkiv.network/tx/0x52e3a781ba8f1653ef4c8faaec94aaf170327b35d00fef882b6b0cb44a1b8aac) |
| Notice signed offline by stamp #2, carried as 4-SMS text | [`0xdd789c71…`](https://tiramisu.explorer.arkiv.network/tx/0xdd789c71f7c08aac4459b6c54c10e7c91136ee724d9aa33a5f44519e1e04bc2c) |

Reproduce:

```sh
npx tsx scripts/smoke-write.ts                 # write through relays, quorum read back, $creator = you
npx tsx scripts/offline.ts fund 1              # online: fund a stamp (key stays in stamps.local.json)
npx tsx scripts/offline.ts sign "your text"    # works with networking disabled
npx tsx scripts/offline.ts carry               # any machine: shows the author, broadcasts
npx tsx scripts/certify.ts                     # snapshot all notices, 3 witnesses re-read + sign + attest
npx tsx scripts/verify.ts examples/notices.tunnel   # offline check (also: app/dist/verify.html from disk)
```

## License

MIT
