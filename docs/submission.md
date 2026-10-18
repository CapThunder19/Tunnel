# Devfolio submission: draft answers

Project name: **Tunnel**
Tagline: *Arkiv access that works through firewalls and offline.*
Repo: https://github.com/CapThunder19/Tunnel · Live app: https://tunnel-app-three.vercel.app
Tracks: **Censorship Resistance**, **Open Source**, **Security**

---

## The problem it solves *

"Read it from Arkiv without our backend" fails for two groups. First, people whose network blocks
the Arkiv RPC domain: national firewalls, campus and office networks, carriers. Second, people with
no connection at all: shutdowns, disasters, SMS-only phones. Tunnel is a viem transport plus small
stateless relays. With one changed line in an Arkiv dApp, its users can read and write through
relays hosted on platforms that are expensive to block, and never have to trust those relays:
- **Writes** are signed on the device, so a relay can only forward them.
- **Reads** go to several relays at the same pinned block and their canonical hashes are compared, so
  a lying relay is flagged.

Offline, an author signs with a pre-funded stamp and hands the transaction over as a QR code, a
file or 4 SMS, and any carrier can broadcast it. `$creator` stays the author. Readers carry
**certified copies**: snapshots at a block that independent witnesses re-read, signed, and
attested on Arkiv, verified by a single HTML file with no network.

## Challenges I ran into *

- **Offline signing with the real SDK.** `createEntity` reads the head block before signing.
  Reading the SDK source showed that `ExpirationTime.fromDays` is sent as a lifetime *relative to
  the inclusion block*, so the head only matters for a sanity check. We answer it locally and
  refuse absolute expiries. Result: a notice signed offline still lives 90 days from when it is
  carried.
- **Making relay answers comparable.** Honest relays return entities and attributes in different
  orders, and the head moves between requests. We canonicalise the raw RPC results (sort by key
  and by attribute name, lowercase hex) and pin `atBlock` for every relay. Then our first live
  write read back empty, because the pin was two blocks behind the write, so the transport now
  never pins below a block it has seen a receipt for.
- **The query budget.** The anonymous `arkiv_query` budget ran out before our first query (HTTP 429
  with a non-JSON-RPC body), and it is shared per IP, which is exactly what a relay is. Relays
  now hold an Arkiv Hub key as a secret, and the client rotates on 429 with `Retry-After`.
- Also: an unfunded wallet produced "Execution error without revert data", and a 2.3 KB offline tx
  was too long for SMS until we deflated it (530 characters). Both are in `arkiv/friction.md`.

## Track answers ("Why this pillar?")

**Censorship Resistance.** Who is censored today: people in countries and on networks that block
domains by DNS or SNI (national firewalls, plus campus, office and carrier filters), and people
cut off by shutdowns, disasters or SMS-only coverage. For them "the data is on Arkiv" means
nothing: one blocked RPC domain hides every Arkiv app, and with no connection they can neither
write nor check a copy someone hands them. What changes from day one:
- Any Arkiv dApp that swaps `http()` for `tunnel(relays)` keeps working through relays on Cloudflare
  and Vercel. Blocking those means blocking a large part of the web, and anyone can deploy another
  relay with one command.
- Relays can't censor selectively without being caught. Writes go to all of them at once, and reads
  are cross-checked at a pinned block.
- Offline, a notice travels as a QR code or 4 SMS and lands with its author intact, and a certified
  copy can be checked on a laptop with Wi-Fi off. Users install nothing (a VPN needs an install,
  is itself blocked or criminalised in places, and does nothing offline).

**Open Source.** Tunnel is an MIT library (`packages/tunnel`, published as `arkiv-tunnel`) that
any Arkiv team can adopt without asking, because it is just a viem transport: their existing SDK
calls don't change. The data contracts are documented and versioned:
- the canonical hashing rules (`canonical.ts`)
- the offline text format `TNL1.<deflate base64url>.<checksum>`
- the certified-copy bundle `tunnel-certified-copy/v1`, with the signed message
  `tunnel:v1|chainId|block|blockTime|queryHash|hash`
- the `attestation` entity in `arkiv/schema.md`

Anyone can run a relay (one file, deployable to Cloudflare, Vercel or Node), and anyone can write
their own verifier from the spec. The verifier is a pure function plus a 59 KB HTML file.

**Security.** Trust in Tunnel never comes from a field anyone can write:
- **Authorship is `$creator`**, which the chain derives from the transaction signature. The UI
  shows it on every notice. A carrier who broadcasts someone else's offline-signed notice can't
  become its author, and the Carry screen shows the recovered signer before sending.
- **Attestations are trusted by `$creator`.** The Verify tab queries `attestation` entities by
  result hash and matches each one's `$creator` against the witness signatures.
- **Relays are untrusted by design.**
  - A relay can't alter a signed tx.
  - A relay that returns a wrong tx hash is flagged.
  - Reads need a quorum at a pinned block, and the minority is flagged.
  - With no majority, the app shows nothing rather than guess.
  - The relay allowlist blocks signing and account methods, and relays log nothing.
- **Certified copies:**
  - a one-byte change, a recomputed hash, or a faked block time each fails verification
  - duplicate or untrusted witnesses don't count
  - a witness refuses to sign if its own re-read differs

  All of this is covered by tests.

---

## Organizer questions

1. **Live app URL:** https://tunnel-app-three.vercel.app (offline verifier: /verify.html)
2. **Does any team member hold Indian nationality?** *(answer yourself)*
3. **Why Arkiv?**
   - **`$creator` comes from the signature and is immutable.** That is what lets an offline-signed
     notice keep its author no matter who carries it. On Postgres or our own API, authorship is a
     column the operator writes.
   - **Queryable state at an exact block (`atBlock`).** This is what makes quorum reads and
     certified copies possible. Independent relays and witnesses answer the same question about
     the same state, so honest answers are byte-identical and a liar stands out. A subgraph or our
     own API has no shared pinned view (and is one operator), and IPFS can prove a file is
     unchanged but can't answer queries or say who wrote what.
   - **Entity Expiration and creation flags** give product rules that no operator can switch off:
     readonly notices that live 90 days from inclusion, and readonly attestations that anyone can
     extend.

   Deliberately off Arkiv: every key, the copy files themselves, pending offline txs, relay
   logs and IPs, the Hub key, and any real personal data.
4. **How do you use Arkiv?**
   - **Attributes vs payload:** `district` and `type` are filters, `ts` and `block` are `u64` for
     ranges, and the notice text is in the payload
     ([app/src/net.ts](https://github.com/CapThunder19/Tunnel/blob/master/app/src/net.ts)).
   - **Queries:** compound predicates and `createdBy()`. Cursor pagination uses one pinned
     `atBlock` across all pages for snapshots
     ([snapshot.ts](https://github.com/CapThunder19/Tunnel/blob/master/packages/tunnel/src/snapshot.ts)).
     `atBlock` pinning is what makes quorum reads comparable
     ([transport.ts](https://github.com/CapThunder19/Tunnel/blob/master/packages/tunnel/src/transport.ts)).
   - **Entity Expiration:** notices 90 days, attestations 30 days. The relative lifetime is what
     makes offline signing work
     ([offline.ts](https://github.com/CapThunder19/Tunnel/blob/master/packages/tunnel/src/offline.ts)).
   - **Creation flags:** notices are `readonly`. Attestations are `readonly` plus
     `permissionlessExtension`, so whoever relies on a copy can keep its evidence alive.
   - **`$creator`:** shown on every notice, recovered and shown to carriers before broadcast, and
     used to match attestations to witnesses (app/src/tabs/verify.ts).
   - **SDK internals:** we run the real SDK through custom viem transports, for both quorum and
     offline signing.
5. **Friction report:** https://github.com/CapThunder19/Tunnel/blob/master/arkiv/friction.md
6. **Wallet addresses:**
   - `0x455a064eB69b064124bcE89f677Ce89d50B92911`: main wallet. Writes notices, funds stamps,
     and is witness #1.
   - `0xC540e63E94fA1aB03B8d1A8dDd1FC2847a83D996` and `0x7FA8B37b86170f6164EB2f6E4E80dfBf43D16153`:
     stamps, the `$creator` of offline-signed notices.
   - `0x1cE965551F79Cd92F5a1132746DdBEC9EFDcF3f0` and `0x699F9c5e20dE345256D5bF865078B9f5249d934a`:
     witnesses #2 and #3 (`attestation` entities).
   - Browser demo keys created in the live app also write notices.
7. **Schema:** https://github.com/CapThunder19/Tunnel/blob/master/arkiv/schema.md
8. **How can judges reproduce?** See "Try it (judges: nothing to install)" in the README:
   1. Read through 2 relays.
   2. Add the lying relay and watch it get flagged.
   3. Verify `examples/notices.tunnel` offline, then tamper one character.
   4. Fund the browser key from the faucet, write a notice, then sign one in airplane mode and
      carry it.

   The exact query for the attestations of the sample copy is in `arkiv/schema.md`, as a curl
   command against the public RPC.
9. **Pre-existing work:** None.
10. **Arkiv surfaces used:** TypeScript SDK, Direct JSON-RPC, Docs, Hub (access key), Faucet, Block Explorer.
11. *(n/a)*
12. **First Arkiv entity:** More than a day (we started on 16 Oct by reading the SDK source and building the transport against read queries; the first write landed on 18 Oct once the wallet was funded).
13. **LLMs used:** Claude (Claude Code) as a coding assistant.
14. **One thing Arkiv should improve first:** make rate limiting and quota visible and machine-readable:
    - return JSON-RPC-shaped errors for 429 and 401
    - document the per-query cost and the anonymous limits next to the RPC URL

    Today a relay or any multi-user backend hits an undocumented per-IP budget that changes from
    day to day.
15. **Open to a feedback call?** *(answer yourself)*
16. / 17. *(confirm)*
18. *(optional)*
