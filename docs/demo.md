# Demo video script (≤ 3:00)

**Setup before recording**
- Browser on https://tunnel-app-three.vercel.app with the demo key funded (≈0.05 GLM) and 2 stamps already prepared (Offline write → *Prepare stamps*).
- A second browser profile or phone as the "carrier".
- Terminal at the repo, editor with `app/src/net.ts` open.
- Hosts-file line ready (as admin): `0.0.0.0 rpc.tiramisu.db-chain.testnet.arkiv.network`
- `examples/notices.tunnel` on the desktop.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Title, then the Read tab | "Every censorship-resistant Arkiv app says you can read the data without its backend. Not if your network blocks the Arkiv RPC, and not if you're offline. Tunnel fixes both." |
| 0:15–0:35 | Add the hosts-file line. Connection → *Direct Arkiv RPC* → Load notices → **error** | "This is a firewall: the Arkiv RPC domain is blocked. A plain Arkiv app is dead." |
| 0:35–0:50 | Editor: `transport: http()` → `transport: tunnel(relays)`. Connection → *Tunnel* → Load notices → **works**, relay table shows 2× agree, same hash, block N | "One line for the developer, nothing for the user. The same query goes to relays on Cloudflare and Vercel at the same pinned block, and their result hashes have to match." |
| 0:50–1:10 | Write tab: post a notice → entity key + explorer → `$creator` = my address | "Writes are signed in the browser. Relays only forward bytes they can't change, and the explorer shows me as the creator, not the relay." |
| 1:10–1:30 | Connection → tick *lying relay* → Load notices → liar row red "disagree", honest notices still shown | "Here's a relay that rewrites results. It's out-voted at block N, flagged, and dropped, and the user still sees the true data." |
| 1:30–2:05 | Airplane mode ON (show the OS indicator). Offline write → type notice → *Sign offline* → QR + text "4 SMS". Carrier device scans the QR (Carry tab) → shows author = stamp + the text → Broadcast → included | "No connection at all. The notice is signed with a pre-funded stamp and leaves as a QR code, a file, or four SMS. Anyone can carry it. They see exactly who signed it and what it says, and when they broadcast it, the creator is still the stamp, not them." |
| 2:05–2:45 | Wi-Fi OFF. Open `verify.html` **from disk**. Drag `notices.tunnel` → green "Authentic · 3/3 trusted witnesses · block 708671". Open the file in an editor, change one character in a payload, drag again → **red "Tampered"** | "And reading when offline: a certified copy is a snapshot at one block that three witnesses each re-read and signed, and each wrote an attestation entity on Arkiv. This single HTML file checks it with no network. Change one byte… red." |
| 2:45–3:00 | README: Why Arkiv table | "This only works on Arkiv. `$creator` comes from the signature, so carriers can't steal authorship. `atBlock` makes every relay and witness answer the same question about the same state. Tunnel: Arkiv through firewalls and offline. MIT, on GitHub." |

Afterwards: remove the hosts-file line.
