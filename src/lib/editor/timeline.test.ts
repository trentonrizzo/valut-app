import { describe, expect, it, vi } from 'vitest'
import {
  activeClipAt,
  addClips,
  clipDuration,
  commitHistory,
  createComposition,
  createCompositionItem,
  createClip,
  deleteClip,
  duplicateClip,
  emptyTimeline,
  newHistory,
  normalizeTimeline,
  primaryClips,
  redoHistory,
  reorderClip,
  repeatClip,
  splitClip,
  timelineDuration,
  undoHistory,
  updateClip,
  updateCompositionItem,
  replaceCompositionItem,
  timelineFileIds,
} from './timeline'

function video(fileId = 'video-1', duration = 10) {
  return createClip({ fileId, mediaType: 'video', sourceDuration: duration })
}

function photo(fileId = 'photo-1', duration = 3) {
  return createClip({ fileId, mediaType: 'image', photoDuration: duration })
}

describe('timeline document and project clock', () => {
  it('creates a deterministic empty primary timeline', () => {
    const timeline = emptyTimeline()
    expect(primaryClips(timeline)).toEqual([])
    expect(timelineDuration(timeline)).toBe(0)
  })

  it('allows the same source to have independent clip identities', () => {
    const original = video('same-file')
    const first = addClips(emptyTimeline(), [original])
    const result = duplicateClip(first, original.clipId)
    const clips = primaryClips(result.timeline)
    expect(clips.map((clip) => clip.fileId)).toEqual(['same-file', 'same-file'])
    expect(new Set(clips.map((clip) => clip.clipId)).size).toBe(2)
  })

  it('calculates trim, slow motion, fast motion, photos and transitions', () => {
    const slow = { ...video('slow', 10), sourceStart: 2, sourceEnd: 8, speed: 0.5 }
    const fast = { ...video('fast', 10), speed: 2 }
    const still = photo('still', 4)
    const timeline = addClips(emptyTimeline(), [slow, fast, still])
    expect(clipDuration(primaryClips(timeline)[0]!)).toBe(12)
    expect(clipDuration(primaryClips(timeline)[1]!)).toBe(5)
    expect(timelineDuration(timeline)).toBe(21)
    expect(activeClipAt(timeline, 13)?.clip.fileId).toBe('fast')
    expect(activeClipAt(timeline, 13)?.sourceTime).toBe(2)
    expect(activeClipAt(timeline, 18)?.clip.fileId).toBe('still')
  })
})

describe('timeline commands', () => {
  it('splits video with source continuity and new identities', () => {
    const source = video('immutable-file', 10)
    const timeline = addClips(emptyTimeline(), [source])
    const result = splitClip(timeline, source.clipId, 4)
    const [left, right] = primaryClips(result.timeline)
    expect(left?.sourceEnd).toBe(4)
    expect(right?.sourceStart).toBe(4)
    expect(right?.fileId).toBe('immutable-file')
    expect(right?.clipId).not.toBe(left?.clipId)
  })

  it('splits a photo into meaningful sequential durations', () => {
    const source = photo('still', 6)
    const result = splitClip(addClips(emptyTimeline(), [source]), source.clipId, 2)
    expect(primaryClips(result.timeline).map((clip) => clip.photoDuration)).toEqual([2, 4])
  })

  it('refuses invalid edge splits', () => {
    const source = video('file', 10)
    const timeline = addClips(emptyTimeline(), [source])
    expect(splitClip(timeline, source.clipId, 0.01).rightClipId).toBeNull()
  })

  it('deletes only the clip instruction', () => {
    const source = video()
    const storageDelete = vi.fn()
    const result = deleteClip(addClips(emptyTimeline(), [source]), source.clipId)
    expect(primaryClips(result)).toHaveLength(0)
    expect(storageDelete).not.toHaveBeenCalled()
  })

  it('duplicates, repeats and reorders without creating source media', () => {
    const a = video('a')
    const b = photo('b')
    let timeline = addClips(emptyTimeline(), [a, b])
    timeline = duplicateClip(timeline, a.clipId).timeline
    timeline = repeatClip(timeline, b.clipId, 2)
    expect(primaryClips(timeline).map((clip) => clip.fileId)).toEqual(['a', 'a', 'b', 'b', 'b'])
    timeline = reorderClip(timeline, 4, 0)
    expect(primaryClips(timeline)[0]?.fileId).toBe('b')
    expect(new Set(primaryClips(timeline).map((clip) => clip.clipId)).size).toBe(5)
  })

  it('speed and photo duration edits immediately reflow starts', () => {
    const a = video('a', 10)
    const b = photo('b', 3)
    let timeline = addClips(emptyTimeline(), [a, b])
    timeline = updateClip(timeline, a.clipId, { speed: 2 })
    expect(primaryClips(timeline)[1]?.timelineStart).toBe(5)
    timeline = updateClip(timeline, b.clipId, { photoDuration: 8 })
    expect(timelineDuration(timeline)).toBe(13)
  })

  it('undoes and redoes meaningful document edits', () => {
    const clip = video()
    const initial = emptyTimeline()
    const edited = addClips(initial, [clip])
    let history = commitHistory(newHistory(initial), edited)
    history = undoHistory(history)
    expect(primaryClips(history.present)).toHaveLength(0)
    history = redoHistory(history)
    expect(primaryClips(history.present)).toHaveLength(1)
  })
})

describe('timeline compositions', () => {
  it('stores mixed media as one non-destructive composition clip', () => {
    const items = [
      createCompositionItem({ fileId: 'photo-a', mediaType: 'image' }),
      createCompositionItem({ fileId: 'video-b', mediaType: 'video', sourceDuration: 12 }),
    ]
    const clip = createComposition(items, 'horizontal')
    const timeline = addClips(emptyTimeline(), [clip])
    expect(primaryClips(timeline)[0]?.mediaType).toBe('composition')
    expect(timelineFileIds(timeline)).toEqual(['photo-a', 'video-b'])
    expect(clipDuration(primaryClips(timeline)[0]!)).toBe(12)
    expect(primaryClips(timeline)[0]?.composition?.items[0]?.transform.width).toBe(.5)
  })

  it.each([
    ['horizontal', 2, .5, 1],
    ['vertical', 2, 1, .5],
    ['three', 3, .6, 1],
    ['grid', 4, .5, .5],
  ] as const)('applies the %s preset to %i cells', (layout, count, width, height) => {
    const items = Array.from({ length: count }, (_, index) => createCompositionItem({ fileId: `f-${index}`, mediaType: index % 2 ? 'video' : 'image', sourceDuration: 6 }))
    const composition = createComposition(items, layout).composition!
    expect(composition.items).toHaveLength(count)
    expect(composition.items[0]?.transform).toMatchObject({ width, height })
  })

  it('edits one cell without changing immutable source references and supports undo', () => {
    const clip = createComposition([
      createCompositionItem({ fileId: 'a', mediaType: 'image' }),
      createCompositionItem({ fileId: 'b', mediaType: 'video', sourceDuration: 5 }),
    ])
    const initial = addClips(emptyTimeline(), [clip])
    const itemId = clip.composition!.items[1]!.itemId
    const edited = updateCompositionItem(initial, clip.clipId, itemId, { muted: false, volume: .4 })
    expect(primaryClips(edited)[0]?.composition?.items[1]).toMatchObject({ fileId: 'b', muted: false, volume: .4 })
    const history = undoHistory(commitHistory(newHistory(initial), edited))
    expect(primaryClips(history.present)[0]?.composition?.items[1]?.muted).toBe(true)
  })

  it('replaces media while retaining the cell geometry', () => {
    const original = createCompositionItem({ fileId: 'old', mediaType: 'image' })
    const clip = createComposition([original, createCompositionItem({ fileId: 'other', mediaType: 'image' })], 'horizontal')
    const initial = addClips(emptyTimeline(), [clip])
    const replacement = createCompositionItem({ fileId: 'new', mediaType: 'video', sourceDuration: 8 })
    const changed = replaceCompositionItem(initial, clip.clipId, original.itemId, replacement)
    const item = primaryClips(changed)[0]?.composition?.items[0]
    expect(item).toMatchObject({ fileId: 'new', mediaType: 'video' })
    expect(item?.transform.width).toBe(.5)
  })

  it('duplicates and deletes only composition instructions', () => {
    const storageDelete = vi.fn()
    const clip = createComposition([createCompositionItem({ fileId: 'r2-source', mediaType: 'video', sourceDuration: 4 })])
    const initial = addClips(emptyTimeline(), [clip])
    const duplicated = duplicateClip(initial, clip.clipId).timeline
    expect(primaryClips(duplicated)).toHaveLength(2)
    expect(timelineFileIds(duplicated)).toEqual(['r2-source'])
    expect(primaryClips(deleteClip(duplicated, clip.clipId))).toHaveLength(1)
    expect(storageDelete).not.toHaveBeenCalled()
  })

  it('normalizes saved composition documents without discarding items', () => {
    const clip = createComposition([createCompositionItem({ fileId: 'a', mediaType: 'image' }), createCompositionItem({ fileId: 'b', mediaType: 'video', sourceDuration: 7 })], 'vertical')
    const saved = JSON.parse(JSON.stringify(addClips(emptyTimeline(), [clip])))
    const loaded = primaryClips(normalizeTimeline(saved))[0]
    expect(loaded?.composition?.items.map((item) => item.fileId)).toEqual(['a', 'b'])
    expect(loaded?.composition?.layout).toBe('vertical')
  })

  it('does not split a composition into corrupt partial instructions', () => {
    const clip = createComposition([createCompositionItem({ fileId: 'a', mediaType: 'image' })])
    const timeline = addClips(emptyTimeline(), [clip])
    expect(splitClip(timeline, clip.clipId, 1).rightClipId).toBeNull()
  })
})
