# Changelog

## 0.1.0 (2026-10-18)

First release, built for Arkiv: Global Tour Stop (pre-Devcon 8).

- `tunnel()` viem transport: quorum `arkiv_query` at a pinned block with canonical hashing, majority
  vote and liar flagging; parallel broadcast with tx-hash check; rotation on network errors and
  429; read-your-writes pin floor; local `eth_chainId`.
- Offline writes: one-shot funded stamps, `signOffline` (the real SDK, no network), the `TNL1` text
  format (deflate + base64url + checksum, QR / file / SMS), carrier `inspect` + `broadcast`.
- Certified copies: `takeSnapshot`, `attest` (independent re-read, EIP-191 signature, `attestation`
  entity), pure `verifyOffline`, and a single-file offline verifier page.
- Relay registry: `relay` lease entities renewed hourly with `extendEntity` while healthy (Cloudflare
  cron), `listRelays` trusted by `$creator`, live view over WebSocket `watchEntityEvents`.
- Relay: stateless allowlisted JSON-RPC forwarder for Cloudflare Workers, Vercel Edge and Node.
- Demo app: notice board with Read, Write, Offline write, Carry, Verify copy and Relays.
