# Contributing to Tunnel

Thanks for helping keep Arkiv reachable. Issues and pull requests are welcome.

## Development setup

```sh
git clone https://github.com/CapThunder19/Tunnel && cd Tunnel
npm install
npm test            # library + relay unit tests (no network needed)
npm run typecheck
```

For live testing against Tiramisu, copy `.env.example` to `.env.local` and add a funded test key
(get test GLM at https://hub.arkiv.network/faucet). **Never commit keys**: `.env*`, `*.local.json`
and `.dev.vars` are gitignored on purpose.

## Where things live

| Change | Look at |
|---|---|
| Quorum logic, retries, read-your-writes | `packages/tunnel/src/transport.ts` (+ `test/transport.test.ts`) |
| Hashing rules (anything here changes every hash) | `packages/tunnel/src/canonical.ts` |
| Offline signing, `TNL1` text format | `packages/tunnel/src/offline.ts` |
| Certified copies | `packages/tunnel/src/snapshot.ts`, `verify.ts` |
| Relay registry | `packages/tunnel/src/registry.ts`, `relay/src/worker.ts` |
| The relay itself | `relay/src/core.ts` (shared by Worker, Vercel and Node) |
| Demo app | `app/src` |

## Ground rules

- **Formats are contracts.** `canonical.ts`, the `TNL1.` text format, the bundle format
  `tunnel-certified-copy/v1` and the attestation message `tunnel:v1|…` are relied on by other
  implementations. Changing them needs a new version tag, not an edit.
- **Relays stay dumb.** No logging of IPs or bodies, no state, no new methods on the allowlist
  without a reason in the PR.
- **Tests with every behaviour change.** The fake relay network in `packages/tunnel/test/fakeNet.ts`
  makes lying, slow and rate-limited relays easy to simulate.
- **Synthetic data only.** Never put real personal data in a test, a fixture or an Arkiv entity.

## Running your own relay

See [Run your own relay](README.md#run-your-own-relay) in the README. More independent relays
make every Tunnel user harder to censor.
