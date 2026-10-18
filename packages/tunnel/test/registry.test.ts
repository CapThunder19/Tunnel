import { describe, expect, it } from 'vitest'
import { listRelays, renewLeases } from '../src/registry.js'

const OP = '0x9Fb8276AA99d5778C7562E4A46A73536F3803164'
const attr = (v: string) => ({ type: 'str', value: v })

function fakeOperator(entities: any[]) {
  const calls: { op: string; p: any }[] = []
  let lastWhere: any[] = []
  const select = () => ({
    where(f: any[]) {
      lastWhere = f
      return this
    },
    limit() {
      return this
    },
    fetch: async () => ({ entities }),
  })
  return {
    calls,
    where: () => lastWhere.map(String),
    account: { address: OP as `0x${string}` },
    select,
    createEntity: async (p: any) => (calls.push({ op: 'create', p }), { entityKey: '0x01' as `0x${string}`, txHash: '0xaa' as `0x${string}` }),
    extendEntity: async (p: any) => (calls.push({ op: 'extend', p }), { entityKey: p.entityKey, txHash: '0xbb' as `0x${string}` }),
  }
}

describe('relay registry', () => {
  it('lists relays filtered by operator $creator, dropping junk and duplicates', async () => {
    const op = fakeOperator([
      { key: '0xk1', creator: OP, expiresAt: 10n, attributes: { url: attr('https://a.example'), region: attr('eu') } },
      { key: '0xk2', creator: OP, expiresAt: 11n, attributes: { url: attr('https://a.example'), region: attr('eu') } },
      { key: '0xk3', creator: OP, expiresAt: 12n, attributes: { url: attr('javascript:alert(1)'), region: attr('x') } },
    ])
    const relays = await listRelays(op, [OP])
    expect(relays.map((r) => r.url)).toEqual(['https://a.example'])
    expect(op.where().join(' ')).toContain(`$creator = addr(${OP})`)
  })

  it('extends healthy relays, creates missing ones, and lets unhealthy ones lapse', async () => {
    const op = fakeOperator([{ key: '0xk1', creator: OP, expiresAt: 10n, attributes: { url: attr('https://a.example'), region: attr('eu') } }])
    const res = await renewLeases(
      op,
      [
        { url: 'https://a.example', region: 'eu' },
        { url: 'https://b.example', region: 'us' },
        { url: 'https://dead.example', region: 'us' },
      ],
      { health: async (u) => !u.includes('dead') },
    )
    expect(res.map((r) => r.action)).toEqual(['extended', 'created', 'skipped-unhealthy'])
    expect(op.calls[0]).toMatchObject({ op: 'extend', p: { entityKey: '0xk1', expires: { minLifetime: 3600n, expiresAt: 0n } } })
    expect(op.calls[1].p.attributes.url.value).toBe('https://b.example')
    expect(op.calls[1].p.flags).toBeUndefined() // a lease, not readonly: the operator extends it
  })
})
