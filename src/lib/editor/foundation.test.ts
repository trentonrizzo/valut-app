import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyPayload, emptyTimelinePayload, layersForLayout, normalizePayload, reflowLayersForLayout, stableDocumentJson } from './projects'
import { RequestGeneration, toggleRecord } from './pickerState'
import { cursorPredicate } from '../mediaCursor'

describe('project compatibility and picker state', () => {
  it('retains unknown fields and does not mutate a legacy document on read', () => {
    const legacy = { version: 1, layout: '1', future: { a: true }, slots: [{ fileId: 'source', kind: 'video', trimStart: 2, trimEnd: 8, muted: false, objectFit: 'contain', futureClip: 'keep' }] }
    const before = JSON.stringify(legacy)
    const normalized = normalizePayload(legacy)
    expect(JSON.stringify(legacy)).toBe(before)
    expect(normalized.future).toEqual({ a: true })
    expect(normalized.scenes[0].layers[0]).toMatchObject({ futureClip: 'keep', fileId: 'source', trimStart: 2 })
  })
  it('refuses future versions instead of downgrading them', () => {
    expect(() => normalizePayload({ version: 99, privateFuture: true })).toThrow(/newer format/)
  })
  it('layout shrink never truncates any existing layer instructions', () => {
    const p = emptyPayload('2x2'); p.scenes[0].layers[3].fileId = 'keep-me'
    expect(layersForLayout('1', p.scenes[0].layers)).toEqual(p.scenes[0].layers)
  })
  it('reflows populated cells while refusing to discard edited or unknown layer instructions', () => {
    const p = emptyPayload('2x2')
    p.scenes[0].layers[3].fileId = 'keep-me'; p.scenes[0].layers[3].kind = 'video'
    expect(reflowLayersForLayout('1', p.scenes[0].layers)?.map(layer => layer.fileId)).toEqual(['keep-me'])
    const second = { ...p.scenes[0].layers[1], zoom: 2 }
    expect(reflowLayersForLayout('1', [p.scenes[0].layers[3], second])).toBeNull()
    const future = { ...p.scenes[0].layers[0], futureInstruction: true }
    expect(reflowLayersForLayout('1', [p.scenes[0].layers[3], future])).toBeNull()
  })
  it('selected records survive different searches, albums, and missing current rows', () => {
    let selected = toggleRecord(new Map(), { id: 'a', album: 'first' }, 4)
    selected = toggleRecord(selected, { id: 'b', album: 'second' }, 4)
    expect([...selected.values()]).toEqual([{ id: 'a', album: 'first' }, { id: 'b', album: 'second' }])
  })
  it('cancels old queries and rejects stale response application', () => {
    const gate = new RequestGeneration(); const old = gate.begin(); const latest = gate.begin()
    expect(old.signal.aborted).toBe(true); expect(old.current()).toBe(false); expect(latest.current()).toBe(true)
    gate.cancel(); expect(latest.current()).toBe(false)
  })
  it('response-loss comparison ignores JSONB object key order', () => {
    expect(stableDocumentJson({ b: 2, a: { d: 4, c: 3 } })).toBe(stableDocumentJson({ a: { c: 3, d: 4 }, b: 2 }))
  })
  it('opening a legacy project does not convert or rewrite its raw document', () => {
    const legacy = emptyPayload('1x2')
    const before = structuredClone(legacy)
    const normalized = normalizePayload(legacy)
    expect(legacy).toEqual(before)
    expect(normalized.version).toBe(2)
    expect(emptyTimelinePayload().version).toBe(3)
  })
})

describe('complete sort cursor', () => {
  it('retains equal-value rows using the descending ID tie-break', () => {
    const predicate = cursorPredicate('rating', false, { id: 'b', num: 5, ts: null, value: 5 })
    expect(predicate).toBe('rating.lt.5,and(rating.eq.5,id.lt."b"),rating.is.null')
  })
  it('handles equal timestamps, ascending values, and null tails', () => {
    expect(cursorPredicate('created_at', true, { id: 'b', ts: '2026-01-01', num: null })).toContain('and(created_at.eq."2026-01-01",id.lt."b")')
    expect(cursorPredicate('captured_at', false, { id: 'b', ts: null, num: null, value: null })).toBe('and(captured_at.is.null,id.lt."b")')
  })
  it('favorites includes favorite group, date, and ID boundaries', () => {
    const p = cursorPredicate('favorite', false, { id: 'b', ts: '2026-01-01', num: 1, value: true }, 'created_at')
    expect(p).toContain('favorite.lt.true')
    expect(p).toContain('and(favorite.eq.true,created_at.eq."2026-01-01",id.lt."b")')
  })
})

it.skipIf(!process.env.VAULT_COMPAT_FIXTURE)('normalizes every existing production project without changing its raw payload or layer fields', () => {
  const rows = JSON.parse(readFileSync(process.env.VAULT_COMPAT_FIXTURE!, 'utf8'))
  for (const row of rows) {
    const before = JSON.stringify(row.payload)
    const normalized = normalizePayload(row.payload)
    expect(JSON.stringify(row.payload)).toBe(before)
    for (const [i, scene] of row.payload.scenes.entries()) {
      expect(normalized.scenes[i]).toMatchObject(scene)
    }
  }
})
