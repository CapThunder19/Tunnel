import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Hex } from 'viem'

/** Minimal .env.local loader (no dependency). Never prints values. */
export function loadEnv(): Record<string, string> {
  const file = resolve(import.meta.dirname, '..', '.env.local')
  const env: Record<string, string> = {}
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2]
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string> }
}

export function privateKey(env = loadEnv()): Hex {
  const pk = env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY missing: add it to .env.local')
  return (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex
}

export function relays(env = loadEnv()): string[] {
  return (env.RELAYS ?? 'http://127.0.0.1:8787,http://127.0.0.1:8788').split(',').map((s) => s.trim()).filter(Boolean)
}

export const bigintJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)
