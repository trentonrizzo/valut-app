export const TIMELINE_VERSION = 3 as const
export const PRIMARY_TRACK_ID = 'primary'
export const MIN_CLIP_DURATION = 0.1
export const DEFAULT_PHOTO_DURATION = 3

export type TimelineMediaType = 'image' | 'video'
export type TimelineTransform = {
  objectFit: 'cover' | 'contain'
  zoom: number
  panX: number
  panY: number
}

export type TimelineClip = {
  [key: string]: unknown
  clipId: string
  fileId: string
  mediaType: TimelineMediaType
  trackId: string
  timelineStart: number
  sourceStart: number
  sourceEnd: number | null
  sourceDuration: number | null
  photoDuration: number
  speed: number
  volume: number
  muted: boolean
  transform: TimelineTransform
  repeatedFromClipId?: string
  createdAt: string
}

export type TimelineTrack = {
  [key: string]: unknown
  trackId: string
  kind: string
  clips: TimelineClip[]
}

export type TimelineDocument = {
  [key: string]: unknown
  canvas: { aspectRatio: 'original' | '16:9' | '9:16' | '1:1'; background: string }
  tracks: TimelineTrack[]
  settings: { defaultPhotoDuration: number }
}

export function uid() {
  return crypto.randomUUID()
}

export function emptyTimeline(): TimelineDocument {
  return {
    canvas: { aspectRatio: 'original', background: '#000000' },
    tracks: [{ trackId: PRIMARY_TRACK_ID, kind: 'primary', clips: [] }],
    settings: { defaultPhotoDuration: DEFAULT_PHOTO_DURATION },
  }
}

export function primaryClips(timeline: TimelineDocument): TimelineClip[] {
  return timeline.tracks.find((track) => track.trackId === PRIMARY_TRACK_ID)?.clips ?? []
}

export function sourceEnd(clip: TimelineClip): number {
  if (clip.mediaType === 'image') return clip.photoDuration
  return Math.max(clip.sourceStart + MIN_CLIP_DURATION, clip.sourceEnd ?? clip.sourceDuration ?? clip.sourceStart + 5)
}

export function clipDuration(clip: TimelineClip): number {
  if (clip.mediaType === 'image') return Math.max(MIN_CLIP_DURATION, clip.photoDuration)
  return Math.max(MIN_CLIP_DURATION, (sourceEnd(clip) - clip.sourceStart) / Math.max(0.05, clip.speed))
}

export function normalizeTimeline(timeline: TimelineDocument | null | undefined): TimelineDocument {
  const base = emptyTimeline()
  const incoming = timeline && typeof timeline === 'object' ? timeline : base
  const tracks = Array.isArray(incoming.tracks) && incoming.tracks.length ? incoming.tracks : base.tracks
  const primary = tracks.find((track) => track.trackId === PRIMARY_TRACK_ID) ?? tracks[0]!
  const clips = (Array.isArray(primary.clips) ? primary.clips : []).filter((clip) => clip?.fileId).map((clip) => ({
    ...clip,
    clipId: clip.clipId || uid(),
    trackId: PRIMARY_TRACK_ID,
    timelineStart: Number.isFinite(clip.timelineStart) ? clip.timelineStart : 0,
    sourceStart: Math.max(0, Number(clip.sourceStart) || 0),
    sourceEnd: clip.sourceEnd == null ? null : Math.max(0, Number(clip.sourceEnd) || 0),
    sourceDuration: clip.sourceDuration == null ? null : Math.max(0, Number(clip.sourceDuration) || 0),
    photoDuration: Math.max(MIN_CLIP_DURATION, Number(clip.photoDuration) || DEFAULT_PHOTO_DURATION),
    speed: Math.min(8, Math.max(0.05, Number(clip.speed) || 1)),
    volume: Number.isFinite(Number(clip.volume)) ? Math.min(1, Math.max(0, Number(clip.volume))) : 1,
    muted: Boolean(clip.muted),
    transform: {
      objectFit: clip.transform?.objectFit === 'contain' ? 'contain' as const : 'cover' as const,
      zoom: Math.min(5, Math.max(1, Number(clip.transform?.zoom) || 1)),
      panX: Math.min(1, Math.max(-1, Number(clip.transform?.panX) || 0)),
      panY: Math.min(1, Math.max(-1, Number(clip.transform?.panY) || 0)),
    },
    createdAt: clip.createdAt || new Date().toISOString(),
  }))
  return reflowTimeline({
    ...incoming,
    canvas: { ...base.canvas, ...(incoming.canvas ?? {}) },
    tracks: tracks.map((track) => track === primary ? { ...primary, trackId: PRIMARY_TRACK_ID, kind: 'primary', clips } : track),
    settings: { ...base.settings, ...(incoming.settings ?? {}) },
  })
}

export function reflowTimeline(timeline: TimelineDocument): TimelineDocument {
  let cursor = 0
  const clips = primaryClips(timeline).map((clip) => {
    const next = { ...clip, timelineStart: cursor }
    cursor += clipDuration(next)
    return next
  })
  return { ...timeline, tracks: timeline.tracks.map((track) => track.trackId === PRIMARY_TRACK_ID ? { ...track, clips } : track) }
}

export function timelineDuration(timeline: TimelineDocument): number {
  return primaryClips(timeline).reduce((sum, clip) => sum + clipDuration(clip), 0)
}

export function activeClipAt(timeline: TimelineDocument, projectTime: number): { clip: TimelineClip; sourceTime: number; localTime: number } | null {
  const duration = timelineDuration(timeline)
  const t = Math.min(Math.max(0, projectTime), Math.max(0, duration - 0.0001))
  const clip = primaryClips(timeline).find((candidate) => t >= candidate.timelineStart && t < candidate.timelineStart + clipDuration(candidate))
  if (!clip) return null
  const localTime = Math.max(0, t - clip.timelineStart)
  const sourceTime = clip.mediaType === 'video'
    ? Math.min(sourceEnd(clip), clip.sourceStart + localTime * clip.speed)
    : localTime
  return { clip, sourceTime, localTime }
}

export function createClip(input: {
  fileId: string
  mediaType: TimelineMediaType
  sourceDuration?: number | null
  photoDuration?: number
}): TimelineClip {
  const sourceDuration = input.sourceDuration && input.sourceDuration > 0 ? input.sourceDuration : null
  return {
    clipId: uid(), fileId: input.fileId, mediaType: input.mediaType, trackId: PRIMARY_TRACK_ID,
    timelineStart: 0, sourceStart: 0, sourceEnd: input.mediaType === 'video' ? sourceDuration : null,
    sourceDuration, photoDuration: input.photoDuration ?? DEFAULT_PHOTO_DURATION, speed: 1,
    volume: 1, muted: true, transform: { objectFit: 'cover', zoom: 1, panX: 0, panY: 0 },
    createdAt: new Date().toISOString(),
  }
}

function replaceClips(timeline: TimelineDocument, clips: TimelineClip[]): TimelineDocument {
  return reflowTimeline({ ...timeline, tracks: timeline.tracks.map((track) => track.trackId === PRIMARY_TRACK_ID ? { ...track, clips } : track) })
}

export function addClips(timeline: TimelineDocument, clips: TimelineClip[]) {
  return replaceClips(timeline, [...primaryClips(timeline), ...clips])
}

export function updateClip(timeline: TimelineDocument, clipId: string, patch: Partial<TimelineClip>): TimelineDocument {
  return replaceClips(timeline, primaryClips(timeline).map((clip) => clip.clipId === clipId ? { ...clip, ...patch, clipId: clip.clipId, fileId: clip.fileId, trackId: clip.trackId } : clip))
}

export function deleteClip(timeline: TimelineDocument, clipId: string): TimelineDocument {
  return replaceClips(timeline, primaryClips(timeline).filter((clip) => clip.clipId !== clipId))
}

export function duplicateClip(timeline: TimelineDocument, clipId: string): { timeline: TimelineDocument; clipId: string | null } {
  const clips = primaryClips(timeline)
  const index = clips.findIndex((clip) => clip.clipId === clipId)
  if (index < 0) return { timeline, clipId: null }
  const duplicate = { ...structuredClone(clips[index]!), clipId: uid(), createdAt: new Date().toISOString() }
  const next = [...clips.slice(0, index + 1), duplicate, ...clips.slice(index + 1)]
  return { timeline: replaceClips(timeline, next), clipId: duplicate.clipId }
}

export function repeatClip(timeline: TimelineDocument, clipId: string, count = 1): TimelineDocument {
  const clips = primaryClips(timeline)
  const index = clips.findIndex((clip) => clip.clipId === clipId)
  if (index < 0 || count < 1) return timeline
  const source = clips[index]!
  const repeats = Array.from({ length: Math.min(99, Math.floor(count)) }, () => ({
    ...structuredClone(source), clipId: uid(), repeatedFromClipId: source.clipId, createdAt: new Date().toISOString(),
  }))
  return replaceClips(timeline, [...clips.slice(0, index + 1), ...repeats, ...clips.slice(index + 1)])
}

export function splitClip(timeline: TimelineDocument, clipId: string, projectTime: number): { timeline: TimelineDocument; rightClipId: string | null } {
  const clips = primaryClips(timeline)
  const index = clips.findIndex((clip) => clip.clipId === clipId)
  if (index < 0) return { timeline, rightClipId: null }
  const clip = clips[index]!
  const local = projectTime - clip.timelineStart
  const duration = clipDuration(clip)
  if (local < MIN_CLIP_DURATION || duration - local < MIN_CLIP_DURATION) return { timeline, rightClipId: null }
  const rightId = uid()
  let left: TimelineClip
  let right: TimelineClip
  if (clip.mediaType === 'video') {
    const splitSource = clip.sourceStart + local * clip.speed
    left = { ...clip, sourceEnd: splitSource }
    right = { ...structuredClone(clip), clipId: rightId, sourceStart: splitSource, createdAt: new Date().toISOString() }
  } else {
    left = { ...clip, photoDuration: local }
    right = { ...structuredClone(clip), clipId: rightId, photoDuration: duration - local, createdAt: new Date().toISOString() }
  }
  return { timeline: replaceClips(timeline, [...clips.slice(0, index), left, right, ...clips.slice(index + 1)]), rightClipId: rightId }
}

export function reorderClip(timeline: TimelineDocument, from: number, to: number): TimelineDocument {
  const clips = [...primaryClips(timeline)]
  if (from < 0 || from >= clips.length || to < 0 || to >= clips.length || from === to) return timeline
  const [moved] = clips.splice(from, 1)
  clips.splice(to, 0, moved!)
  return replaceClips(timeline, clips)
}

export type TimelineHistory = { past: TimelineDocument[]; present: TimelineDocument; future: TimelineDocument[] }
export function newHistory(timeline: TimelineDocument): TimelineHistory { return { past: [], present: structuredClone(timeline), future: [] } }
export function commitHistory(history: TimelineHistory, next: TimelineDocument): TimelineHistory {
  return { past: [...history.past.slice(-49), structuredClone(history.present)], present: structuredClone(next), future: [] }
}
export function undoHistory(history: TimelineHistory): TimelineHistory {
  const prior = history.past.at(-1)
  if (!prior) return history
  return { past: history.past.slice(0, -1), present: structuredClone(prior), future: [structuredClone(history.present), ...history.future].slice(0, 50) }
}
export function redoHistory(history: TimelineHistory): TimelineHistory {
  const next = history.future[0]
  if (!next) return history
  return { past: [...history.past.slice(-49), structuredClone(history.present)], present: structuredClone(next), future: history.future.slice(1) }
}
