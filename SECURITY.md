# Security policy

## Threat model in one paragraph

Relays are **untrusted**. A relay can drop requests, see the IP of whoever talks to it, and lie
about query results. It cannot alter or forge a write (transactions are signed on the user's
device, and the client checks that the returned tx hash is `keccak256` of what it sent), and it
cannot lie about reads without being caught by a quorum of honest relays at the same pinned block.
Certified copies are trusted only through witness signatures, which are checked against a list of
witness addresses the verifier chooses. Authorship is always the chain-derived `$creator`.

Known limits (by design) are listed under "Honest limits" in the [README](README.md#honest-limits).

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability. Report it privately through
[GitHub security advisories](https://github.com/CapThunder19/Tunnel/security/advisories/new),
with steps to reproduce. We aim to reply within 72 hours.

Especially interesting:
- a way for a single relay (or a minority) to make a client accept a wrong `arkiv_query` result
- two different entity sets with the same canonical hash, or one entity set with two
- a certified copy that `verifyOffline` accepts after its contents or block time changed
- a way to make `signOffline` touch the network, or to change a signed `TNL1` text without the
  checksum or signature failing
- anything that leaks keys from browser storage to a relay

## Scope

This is testnet software (Arkiv Tiramisu). Do not use the demo's browser-stored keys for anything
of value.
