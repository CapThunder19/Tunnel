/**
 * Verify a certified copy offline from the command line.
 *   npx tsx scripts/verify.ts examples/notices.tunnel [trusted,addresses]
 */
import { readFileSync } from 'node:fs'
import { verifyOffline } from '../packages/tunnel/src/verify.js'

const [file = 'examples/notices.tunnel', list] = process.argv.slice(2)
const bundle = JSON.parse(readFileSync(file, 'utf8'))
const trusted = list ? list.split(',') : bundle.attestations.map((a: { witness: string }) => a.witness)
const r = await verifyOffline(bundle, trusted)
console.log(r.authentic ? 'AUTHENTIC' : 'NOT AUTHENTIC', `· ${r.trustedCount}/${r.witnesses.length} trusted witnesses · block ${r.block} · ${r.entityCount} entities`)
for (const p of r.problems) console.log(' -', p)
process.exit(r.authentic ? 0 : 1)
