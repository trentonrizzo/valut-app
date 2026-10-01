import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectWriter, type Draft, type ProjectDocument } from './persistence'
import { emptyPayload, emptyTimelinePayload } from './projects'
import { addClips, createClip } from './timeline'
function document(id = 'a', title = 'First'): ProjectDocument { return { id, title, payload: emptyPayload() } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
afterEach(() => vi.useRealTimers())
describe('serialized project persistence', () => {
  it('allocates no new identity and prevents duplicate first writes during overlap', async () => {
    const first = deferred<{ updatedAt: string }>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ updatedAt: '2' })
    const store = vi.fn()
    const writer = new ProjectWriter({ document: document(), dirty: false, baseUpdatedAt: null }, { save, store, online: () => true })
    writer.edit(document('a', 'One')); const pending = writer.flush()
    writer.edit(document('a', 'Two')); void writer.flush()
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve({ updatedAt: '1' }); await pending
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.map(c => [c[0].id, c[1]])).toEqual([['a', null], ['a', '1']])
    expect(writer.status).toBe('Saved')
    expect(writer.draft.document.title).toBe('Two')
  })
  it('out-of-order network opportunities cannot reorder saves: the second waits', async () => {
    const a = deferred<{ updatedAt: string }>(), b = deferred<{ updatedAt: string }>()
    const save = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const writer = new ProjectWriter({ document: document(), dirty: false, baseUpdatedAt: '0' }, { save, store: () => {}, online: () => true })
    writer.edit(document('a', 'Old')); const pending = writer.flush()
    writer.edit(document('a', 'Newest'))
    b.resolve({ updatedAt: '2' })
    expect(save).toHaveBeenCalledTimes(1)
    a.resolve({ updatedAt: '1' }); await pending
    expect(save.mock.calls[1][0].title).toBe('Newest')
    expect(writer.draft.baseUpdatedAt).toBe('2')
  })
  it('project A response cannot change project B', async () => {
    const a = deferred<{ updatedAt: string }>()
    const writerA = new ProjectWriter({ document: document('a'), dirty: false, baseUpdatedAt: '0' }, { save: () => a.promise, store: () => {}, online: () => true })
    const writerB = new ProjectWriter({ document: document('b'), dirty: false, baseUpdatedAt: '5' }, { save: async () => ({ updatedAt: '6' }), store: () => {}, online: () => true })
    writerA.edit(document('a', 'A edit')); const pending = writerA.flush()
    writerB.edit(document('b', 'B edit')); await writerB.flush()
    a.resolve({ updatedAt: '1' }); await pending
    expect(writerB.draft.document).toMatchObject({ id: 'b', title: 'B edit' })
    expect(writerB.draft.baseUpdatedAt).toBe('6')
  })
  it('journals synchronously and flushes on immediate navigation before debounce', async () => {
    vi.useFakeTimers()
    let journal: Draft | undefined
    const save = vi.fn().mockResolvedValue({ updatedAt: '1' })
    const writer = new ProjectWriter({ document: document(), dirty: false, baseUpdatedAt: null }, { save, store: d => { journal = structuredClone(d) }, online: () => true })
    writer.edit(document('a', 'Leave now'))
    expect(journal?.document.title).toBe('Leave now')
    expect(save).not.toHaveBeenCalled()
    await writer.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('failed save retains local edits and base revision; retry uses latest edits', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue({ updatedAt: '2' })
    const writer = new ProjectWriter({ document: document(), dirty: false, baseUpdatedAt: '1' }, { save, store: () => {}, online: () => true })
    writer.edit(document('a', 'First edit')); await writer.flush()
    expect(writer.status).toBe('Save failed'); expect(writer.draft.baseUpdatedAt).toBe('1')
    writer.edit(document('a', 'Latest edit')); await writer.flush()
    expect(save.mock.calls[1][0].title).toBe('Latest edit')
    expect(writer.status).toBe('Saved')
  })
  it('offline recovery keeps identity and resumes the stored draft', async () => {
    const draft = { document: document('a', 'Recovered'), baseUpdatedAt: 'old', dirty: true }
    let online = false
    const save = vi.fn().mockResolvedValue({ updatedAt: 'new' })
    const writer = new ProjectWriter(draft, { save, store: () => {}, online: () => online })
    await writer.flush(); expect(save).not.toHaveBeenCalled(); expect(writer.status).toBe('Offline draft')
    online = true; await writer.flush(); expect(save.mock.calls[0][0].id).toBe('a')
  })
  it('opening a clean project never writes or journals it', async () => {
    const save = vi.fn(), store = vi.fn()
    const writer = new ProjectWriter({ document: document(), dirty: false, baseUpdatedAt: '1' }, { save, store, online: () => true })
    await writer.flush(); expect(save).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled()
  })
  it('saves and reloads the exact v3 timeline document through immediate navigation', async () => {
    const payload = emptyTimelinePayload()
    payload.timeline = addClips(payload.timeline!, [createClip({ fileId: 'vault-file', mediaType: 'video', sourceDuration: 12 })])
    const timelineDocument: ProjectDocument = { id: 'timeline-project', title: 'Timeline', payload }
    let journal: Draft | null = null
    const save = vi.fn().mockResolvedValue({ updatedAt: 'next' })
    const writer = new ProjectWriter({ document: timelineDocument, dirty: false, baseUpdatedAt: 'base' }, { save, store: d => { journal = structuredClone(d) }, online: () => true })
    const edited = structuredClone(timelineDocument)
    edited.payload.timeline!.tracks[0]!.clips[0]!.speed = 2
    writer.edit(edited)
    expect((journal as Draft | null)?.document.payload.timeline?.tracks[0]?.clips[0]?.speed).toBe(2)
    await writer.flush()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'timeline-project', payload: expect.objectContaining({ version: 3 }) }), 'base')
    expect(writer.draft.document.payload.timeline?.tracks[0]?.clips[0]?.fileId).toBe('vault-file')
  })
})
