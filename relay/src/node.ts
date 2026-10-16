#!/usr/bin/env node
/**
 * Local relay for demos and tests.
 *
 *   npx tsx relay/src/node.ts --port 8787 --name local-a
 *   npx tsx relay/src/node.ts --port 8789 --name liar --lie     # DEMO ONLY: tampers query results
 *
 * Reads ARKIV_API_KEY and UPSTREAM from the environment.
 */
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { DEFAULT_UPSTREAM, handle } from './core.js'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    host: { type: 'string', default: '127.0.0.1' },
    name: { type: 'string' },
    region: { type: 'string', default: 'local' },
    upstream: { type: 'string' },
    lie: { type: 'boolean', default: false },
  },
})

const port = Number(values.port)
const cfg = {
  upstream: values.upstream ?? process.env.UPSTREAM ?? DEFAULT_UPSTREAM,
  apiKey: process.env.ARKIV_API_KEY || undefined,
  name: values.name ?? `local-${port}`,
  region: values.region,
  lie: values.lie,
}

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const path = new URL(req.url ?? '/', 'http://relay').pathname
  const out = await handle(req.method ?? 'GET', path, Buffer.concat(chunks).toString('utf8'), cfg)
  res.writeHead(out.status, out.headers).end(out.body)
}).listen(port, values.host, () => {
  // No per-request logging: relays must not record who asked what.
  console.log(`tunnel relay "${cfg.name}" on http://${values.host}:${port} -> ${cfg.upstream}${cfg.apiKey ? ' (api key set)' : ''}${cfg.lie ? '  [LYING: demo mode]' : ''}`)
})
