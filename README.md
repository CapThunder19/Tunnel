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

## License

MIT
