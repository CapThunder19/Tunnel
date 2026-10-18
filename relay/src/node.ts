#!/usr/bin/env node
/**
 * Local relay for demos and tests.
 *
 *   npx tsx relay/src/node.ts --port 8787 --name local-a
 *   npx tsx relay/src/node.ts --port 8789 --name liar --lie     # DEMO ONLY: tampers query results
 *
 * Reads ARKIV_API_KEY and UPSTREAM from the environment, or from the repo's .env.local.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_UPSTREAM, handle } from './core.js'

// Local demos: pick up ARKIV_API_KEY / UPSTREAM from the repo's .env.local (never printed).
const envFile = resolve(import.meta.dirname, '..', '..', '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.trim().match(/^(ARKIV_API_KEY|UPSTREAM)\s*=\s*(.*)$/)
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
  }
}

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
