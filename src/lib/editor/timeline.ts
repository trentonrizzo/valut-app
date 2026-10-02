export const TIMELINE_VERSION = 3 as const
export const PRIMARY_TRACK_ID = 'primary'
export const MIN_CLIP_DURATION = 0.1
export const DEFAULT_PHOTO_DURATION = 3

export type TimelineMediaType = 'image' | 'video'
export type CompositionLayout = 'horizontal' | 'vertical' | 'three' | 'grid' | 'free'
export type TimelineTransform = {
  objectFit: 'cover' | 'contain'
  zoom: number
  panX: number
  panY: number
}

export type CompositionItem = {
  [key: string]: unknown
  itemId: string
  fileId: string
  mediaType: TimelineMediaType
  sourceStart: number
  sourceEnd: number | null
  sourceDuration: number | null
  speed: number
  volume: number
  muted: boolean
  transform: TimelineTransform & { x: number; y: number; width: number; height: number }
}

export type TimelineComposition = {
  [key: string]: unknown
  layout: CompositionLayout
  duration: number
  items: CompositionItem[]
  audioPrimaryItemId: string | null
}

export type TimelineClip = {
  [key: string]: unknown
  clipId: string
  fileId: string | null
  mediaType: TimelineMediaType | 'composition'
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
  composition?: TimelineComposition
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

export function clipFileIds(clip: TimelineClip): string[] {
  if (clip.mediaType === 'composition') return clip.composition?.items.map((item) => item.fileId) ?? []
  return clip.fileId ? [clip.fileId] : []
}

export function timelineFileIds(timeline: TimelineDocument): string[] {
  return [...new Set(primaryClips(timeline).flatMap(clipFileIds))]
}

export function sourceEnd(clip: TimelineClip): number {
  if (clip.mediaType === 'composition') return clip.composition?.duration ?? DEFAULT_PHOTO_DURATION
  if (clip.mediaType === 'image') return clip.photoDuration
  return Math.max(clip.sourceStart + MIN_CLIP_DURATION, clip.sourceEnd ?? clip.sourceDuration ?? clip.sourceStart + 5)
}

export function clipDuration(clip: TimelineClip): number {
  if (clip.mediaType === 'composition') return Math.max(MIN_CLIP_DURATION, clip.composition?.duration ?? DEFAULT_PHOTO_DURATION)
  if (clip.mediaType === 'image') return Math.max(MIN_CLIP_DURATION, clip.photoDuration)
  return Math.max(MIN_CLIP_DURATION, (sourceEnd(clip) - clip.sourceStart) / Math.max(0.05, clip.speed))
}

export function normalizeTimeline(timeline: TimelineDocument | null | undefined): TimelineDocument {
  const base = emptyTimeline()
  const incoming = timeline && typeof timeline === 'object' ? timeline : base
  const tracks = Array.isArray(incoming.tracks) && incoming.tracks.length ? incoming.tracks : base.tracks
  const primary = tracks.find((track) => track.trackId === PRIMARY_TRACK_ID) ?? tracks[0]!
  const clips = (Array.isArray(primary.clips) ? primary.clips : []).filter((clip) => clip?.mediaType === 'composition' ? Boolean(clip.composition?.items?.length) : Boolean(clip?.fileId)).map((clip) => ({
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
    composition: clip.mediaType === 'composition' ? normalizeComposition(clip.composition) : undefined,
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

function presetTransforms(layout: CompositionLayout, count: number) {
  const presets: Record<Exclude<CompositionLayout, 'free'>, Array<{ x: number; y: number; width: number; height: number }>> = {
    horizontal: [{ x: 0, y: 0, width: .5, height: 1 }, { x: .5, y: 0, width: .5, height: 1 }],
    vertical: [{ x: 0, y: 0, width: 1, height: .5 }, { x: 0, y: .5, width: 1, height: .5 }],
    three: [{ x: 0, y: 0, width: .6, height: 1 }, { x: .6, y: 0, width: .4, height: .5 }, { x: .6, y: .5, width: .4, height: .5 }],
    grid: [{ x: 0, y: 0, width: .5, height: .5 }, { x: .5, y: 0, width: .5, height: .5 }, { x: 0, y: .5, width: .5, height: .5 }, { x: .5, y: .5, width: .5, height: .5 }],
  }
  const selected = layout === 'free' ? presets.grid : presets[layout]
  return Array.from({ length: count }, (_, index) => selected[index] ?? presets.grid[index] ?? { x: .1, y: .1, width: .4, height: .4 })
}

export function createCompositionItem(input: { fileId: string; mediaType: TimelineMediaType; sourceDuration?: number | null }): CompositionItem {
  const duration = input.sourceDuration && input.sourceDuration > 0 ? input.sourceDuration : null
  return {
    itemId: uid(), fileId: input.fileId, mediaType: input.mediaType, sourceStart: 0,
    sourceEnd: input.mediaType === 'video' ? duration : null, sourceDuration: duration,
    speed: 1, volume: 1, muted: true,
    transform: { objectFit: 'cover', zoom: 1, panX: 0, panY: 0, x: 0, y: 0, width: 1, height: 1 },
  }
}

export function applyCompositionLayout(composition: TimelineComposition, layout: CompositionLayout): TimelineComposition {
  if (layout === 'free') return { ...composition, layout }
  const positions = presetTransforms(layout, composition.items.length)
  return {
    ...composition,
    layout,
    items: composition.items.map((item, index) => ({ ...item, transform: { ...item.transform, ...positions[index] } })),
  }
}

export function normalizeComposition(raw: TimelineComposition | undefined): TimelineComposition {
  const candidate = raw?.layout
  const layout: CompositionLayout = candidate === 'horizontal' || candidate === 'vertical' || candidate === 'three' || candidate === 'grid' || candidate === 'free' ? candidate : 'horizontal'
  const items = (Array.isArray(raw?.items) ? raw!.items : []).slice(0, 4).filter((item) => item?.fileId).map((item) => ({
    ...item,
    itemId: item.itemId || uid(),
    mediaType: item.mediaType === 'video' ? 'video' as const : 'image' as const,
    sourceStart: Math.max(0, Number(item.sourceStart) || 0),
    sourceEnd: item.sourceEnd == null ? null : Math.max(0, Number(item.sourceEnd) || 0),
    sourceDuration: item.sourceDuration == null ? null : Math.max(0, Number(item.sourceDuration) || 0),
    speed: Math.min(8, Math.max(.05, Number(item.speed) || 1)),
    volume: Number.isFinite(Number(item.volume)) ? Math.min(1, Math.max(0, Number(item.volume))) : 1,
    muted: Boolean(item.muted),
    transform: {
      objectFit: item.transform?.objectFit === 'contain' ? 'contain' as const : 'cover' as const,
      zoom: Math.min(5, Math.max(1, Number(item.transform?.zoom) || 1)),
      panX: Math.min(1, Math.max(-1, Number(item.transform?.panX) || 0)),
      panY: Math.min(1, Math.max(-1, Number(item.transform?.panY) || 0)),
      x: Math.min(1, Math.max(0, Number(item.transform?.x) || 0)),
      y: Math.min(1, Math.max(0, Number(item.transform?.y) || 0)),
      width: Math.min(1, Math.max(.1, Number(item.transform?.width) || 1)),
      height: Math.min(1, Math.max(.1, Number(item.transform?.height) || 1)),
    },
  }))
  const normalized: TimelineComposition = {
    ...(raw ?? {}), layout, duration: Math.max(MIN_CLIP_DURATION, Number(raw?.duration) || 5), items,
    audioPrimaryItemId: items.some((item) => item.itemId === raw?.audioPrimaryItemId) ? raw!.audioPrimaryItemId : items.find((item) => item.mediaType === 'video')?.itemId ?? null,
  }
  return raw?.layout ? normalized : applyCompositionLayout(normalized, layout)
}

export function createComposition(items: CompositionItem[], layout?: CompositionLayout): TimelineClip {
  const chosen = layout ?? (items.length <= 2 ? 'horizontal' : items.length === 3 ? 'three' : 'grid')
  const maxVideoDuration = Math.max(0, ...items.map((item) => item.mediaType === 'video' ? Math.max(0, (item.sourceEnd ?? item.sourceDuration ?? 5) - item.sourceStart) / item.speed : 0))
  const composition = applyCompositionLayout({ layout: chosen, duration: Math.max(DEFAULT_PHOTO_DURATION, maxVideoDuration || 5), items: items.slice(0, 4), audioPrimaryItemId: items.find((item) => item.mediaType === 'video')?.itemId ?? null }, chosen)
  return {
    clipId: uid(), fileId: null, mediaType: 'composition', trackId: PRIMARY_TRACK_ID, timelineStart: 0,
    sourceStart: 0, sourceEnd: null, sourceDuration: null, photoDuration: composition.duration, speed: 1,
    volume: 1, muted: false, transform: { objectFit: 'cover', zoom: 1, panX: 0, panY: 0 },
    composition, createdAt: new Date().toISOString(),
  }
}

export function updateComposition(timeline: TimelineDocument, clipId: string, patch: Partial<TimelineComposition>): TimelineDocument {
  const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
  if (!clip?.composition) return timeline
  return updateClip(timeline, clipId, { composition: normalizeComposition({ ...clip.composition, ...patch }) })
}

export function removeCompositionItem(timeline: TimelineDocument, clipId: string, itemId: string): TimelineDocument {
  const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
  if (!clip?.composition) return timeline
  const items = clip.composition.items.filter((item) => item.itemId !== itemId)
  if (!items.length) return deleteClip(timeline, clipId)
  const layout: CompositionLayout = items.length <= 2 ? 'horizontal' : items.length === 3 ? 'three' : 'grid'
  return updateComposition(timeline, clipId, applyCompositionLayout({ ...clip.composition, items, audioPrimaryItemId: clip.composition.audioPrimaryItemId === itemId ? items.find((item) => item.mediaType === 'video')?.itemId ?? null : clip.composition.audioPrimaryItemId }, layout))
}

export function updateCompositionItem(timeline: TimelineDocument, clipId: string, itemId: string, patch: Partial<CompositionItem>): TimelineDocument {
  const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
  if (!clip?.composition) return timeline
  const items = clip.composition.items.map((item) => item.itemId === itemId ? { ...item, ...patch, itemId: item.itemId, fileId: item.fileId } : item)
  return updateComposition(timeline, clipId, { items })
}

export function addCompositionItems(timeline: TimelineDocument, clipId: string, items: CompositionItem[]): TimelineDocument {
  const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
  if (!clip?.composition) return timeline
  const nextItems = [...clip.composition.items, ...items].slice(0, 4)
  return updateComposition(timeline, clipId, applyCompositionLayout({ ...clip.composition, items: nextItems }, nextItems.length <= 2 ? 'horizontal' : nextItems.length === 3 ? 'three' : 'grid'))
}

export function replaceCompositionItem(timeline: TimelineDocument, clipId: string, itemId: string, replacement: CompositionItem): TimelineDocument {
  const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
  if (!clip?.composition) return timeline
  const items = clip.composition.items.map((item) => item.itemId === itemId ? { ...replacement, itemId, transform: item.transform } : item)
  return updateComposition(timeline, clipId, { items })
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
  if (clip.mediaType === 'composition') return { timeline, rightClipId: null }
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
