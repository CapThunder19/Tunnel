import { describe, expect, it } from 'vitest'
import { canonicalJson, hashEntities, hashQuery } from '../src/canonical.js'
import { ENTITIES } from './fakeNet.js'

describe('canonical form', () => {
  it('sorts object keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"b":1}')
  })

  it('encodes bigint as decimal, bytes and hex strings as lowercase hex', () => {
    expect(canonicalJson({ n: 255n, b: new Uint8Array([0xab, 0x01]), h: '0xABcd', s: 'Hello' })).toBe(
      '{"b":"0xab01","h":"0xabcd","n":"255","s":"Hello"}',
    )
  })

  it('gives the same hash regardless of entity order, attribute order and hex case', () => {
    const shuffled = structuredClone(ENTITIES)
      .reverse()
      .map((e) => ({ ...e, key: e.key.toUpperCase().replace('0X', '0x'), attributes: [...e.attributes].reverse() }))
    expect(hashEntities(shuffled)).toBe(hashEntities(ENTITIES))
  })

  it('changes the hash when any value changes', () => {
    const tampered = structuredClone(ENTITIES)
    tampered[1].attributes[2].value = '0x21'
    expect(hashEntities(tampered)).not.toBe(hashEntities(ENTITIES))
  })

  it('is stable across runs (pinned vector)', () => {
    expect(hashEntities([])).toBe('0x4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945') // sha256("[]")
    expect(hashQuery('type = "notice"', { key: true })).toBe(hashQuery('type = "notice"', { key: true }))
  })
})
