# Tunnel

> Arkiv access that works through firewalls and offline.

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
```

## License

MIT
