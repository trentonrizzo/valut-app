import { describe, expect, it, vi } from 'vitest'
import {
  activeClipAt,
  addClips,
  clipDuration,
  commitHistory,
  createClip,
  deleteClip,
  duplicateClip,
  emptyTimeline,
  newHistory,
  primaryClips,
  redoHistory,
  reorderClip,
  repeatClip,
  splitClip,
  timelineDuration,
  undoHistory,
  updateClip,
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
