import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import type { FileRow } from '../../types/media'
import { classifyFileKind } from '../../lib/fileKind'
import { supabase } from '../../lib/supabase'
import type { ProjectWriter } from '../../lib/editor/persistence'
import type { EditorProjectPayload } from '../../lib/editor/projects'
import {
  activeClipAt,
  addCompositionItems,
  addClips,
  applyCompositionLayout,
  clipFileIds,
  clipDuration,
  commitHistory,
  createClip,
  createComposition,
  createCompositionItem,
  deleteClip,
  duplicateClip,
  newHistory,
  normalizeTimeline,
  primaryClips,
  redoHistory,
  removeCompositionItem,
  reorderClip,
  repeatClip,
  sourceEnd,
  splitClip,
  timelineDuration,
  timelineFileIds,
  undoHistory,
  updateClip,
  updateComposition,
  updateCompositionItem,
  replaceCompositionItem,
  type CompositionLayout,
  type TimelineClip,
  type TimelineDocument,
  type TimelineHistory,
} from '../../lib/editor/timeline'
import { useDecryptedMediaSrc } from '../../hooks/useDecryptedMediaSrc'
import { EditorMediaPicker } from './EditorMediaPicker'
import { VaultPhotoTileMedia } from '../files/VaultPhotoTile'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

type Props = {
  projectId: string
  user: User
  title: string
  payload: EditorProjectPayload
  writer: ProjectWriter
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  onTitle: (title: string) => void
  onPayload: (payload: EditorProjectPayload) => void
}

function formatTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  const tenths = Math.floor((safe % 1) * 10)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

export function TimelineWorkspace(props: Props) {
  const navigate = useNavigate()
  const [history, setHistory] = useState<TimelineHistory>(() => newHistory(normalizeTimeline(props.payload.timeline)))
  const timeline = history.present
  const clips = primaryClips(timeline)
  const duration = timelineDuration(timeline)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.clipId ?? null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fileById, setFileById] = useState<Record<string, FileRow>>({})
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set())
  const [pickerMode, setPickerMode] = useState<'sequence' | 'composition-new' | 'composition-add' | 'composition-replace'>('sequence')
  const [selectedCompositionItemId, setSelectedCompositionItemId] = useState<string | null>(null)
  const clockRef = useRef<{ startedAt: number; from: number } | null>(null)
  const durationRef = useRef(duration)
  const selected = clips.find((clip) => clip.clipId === selectedClipId) ?? null
  const active = activeClipAt(timeline, playhead)

  useEffect(() => { durationRef.current = duration }, [duration])

  const persist = useCallback((nextTimeline: TimelineDocument) => {
    const nextPayload: EditorProjectPayload = { ...props.payload, version: 3, timeline: nextTimeline }
    props.onPayload(nextPayload)
    props.writer.edit({ id: props.projectId, title: props.title, payload: nextPayload })
  }, [props])

  const commit = useCallback((next: TimelineDocument) => {
    setHistory((current) => commitHistory(current, next))
    persist(next)
  }, [persist])

  const undo = useCallback(() => {
    const next = undoHistory(history)
    if (next === history) return
    setHistory(next)
    persist(next.present)
  }, [history, persist])

  const redo = useCallback(() => {
    const next = redoHistory(history)
    if (next === history) return
    setHistory(next)
    persist(next.present)
  }, [history, persist])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo(); else undo()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [redo, undo])

  useEffect(() => {
    const ids = timelineFileIds(timeline).filter((id) => !fileById[id] && !missingIds.has(id))
    if (!ids.length) return
    let alive = true
    void supabase.from('files').select('*').eq('user_id', props.user.id).in('id', ids).then(({ data, error }) => {
      if (!alive || error) return
      const found = new Set((data ?? []).map((row) => row.id))
      setMissingIds((prior) => new Set([...prior, ...ids.filter((id) => !found.has(id))]))
      setFileById((prior) => Object.assign({}, prior, ...((data ?? []) as FileRow[]).map((row) => ({ [row.id]: row }))))
    })
    return () => { alive = false }
  }, [timeline, fileById, missingIds, props.user.id])

  useEffect(() => {
    if (!playing) { clockRef.current = null; return }
    let frame = 0
    const tick = (now: number) => {
      if (!clockRef.current) return
      const clock = clockRef.current
      const next = clock.from + (now - clock.startedAt) / 1000
      if (next >= durationRef.current) {
        setPlayhead(durationRef.current)
        setPlaying(false)
        return
      }
      setPlayhead(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  function togglePlayback() {
    if (playing) { setPlaying(false); return }
    const from = playhead >= duration ? 0 : playhead
    setPlayhead(from)
    clockRef.current = { startedAt: performance.now(), from }
    setPlaying(true)
  }

  useEffect(() => {
    if (playhead > duration) setPlayhead(duration)
  }, [duration, playhead])

  function addFiles(files: FileRow[]) {
    setFileById((prior) => Object.assign({}, prior, ...files.map((file) => ({ [file.id]: file }))))
    const media = files.flatMap((file) => {
      const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
      if (kind !== 'image' && kind !== 'video') return []
      return [{ file, kind }]
    })
    if (pickerMode === 'composition-new' && media.length) {
      const items = media.slice(0, 4).map(({ file, kind }) => createCompositionItem({ fileId: file.id, mediaType: kind, sourceDuration: file.duration_ms ? file.duration_ms / 1000 : null }))
      const addition = createComposition(items)
      const next = addClips(timeline, [addition])
      commit(next); setSelectedClipId(addition.clipId); setSelectedCompositionItemId(items[0]?.itemId ?? null); setPlayhead(addition.timelineStart)
      props.setPickerOpen(false); return
    }
    if (selected?.mediaType === 'composition' && selected.composition && media.length && pickerMode === 'composition-add') {
      const items = media.map(({ file, kind }) => createCompositionItem({ fileId: file.id, mediaType: kind, sourceDuration: file.duration_ms ? file.duration_ms / 1000 : null }))
      commit(addCompositionItems(timeline, selected.clipId, items)); props.setPickerOpen(false); return
    }
    if (selected?.mediaType === 'composition' && selected.composition && selectedCompositionItemId && media[0] && pickerMode === 'composition-replace') {
      const { file, kind } = media[0]
      commit(replaceCompositionItem(timeline, selected.clipId, selectedCompositionItemId, createCompositionItem({ fileId: file.id, mediaType: kind, sourceDuration: file.duration_ms ? file.duration_ms / 1000 : null })))
      props.setPickerOpen(false); return
    }
    const additions = media.map(({ file, kind }) => createClip({ fileId: file.id, mediaType: kind, sourceDuration: file.duration_ms ? file.duration_ms / 1000 : null, photoDuration: timeline.settings.defaultPhotoDuration }))
    if (additions.length) {
      const next = addClips(timeline, additions)
      commit(next)
      setSelectedClipId(additions[0]!.clipId)
      setPlayhead(additions[0]!.timelineStart)
    }
    props.setPickerOpen(false)
  }

  function applyClip(patch: Partial<TimelineClip>) {
    if (!selected) return
    commit(updateClip(timeline, selected.clipId, patch))
  }

  function moveSelected(delta: number) {
    if (!selected) return
    const from = clips.findIndex((clip) => clip.clipId === selected.clipId)
    commit(reorderClip(timeline, from, Math.max(0, Math.min(clips.length - 1, from + delta))))
  }

  return <div className="dashboard editor-page editor-page--workspace">
    <main className="dashboard__main editor-workspace timeline-workspace">
      <div className="editor-workspace__bar">
        <button className="btn btn--ghost" onClick={() => { void props.writer.flush(); navigate('/editor') }}>Projects</button>
        <input className="field-input editor-workspace__title" value={props.title} aria-label="Project name" onChange={(event) => props.onTitle(event.target.value)} />
        <button className="btn btn--outline" disabled aria-describedby="timeline-export-note">Export</button>
      </div>
      <div className="editor-save-status" role="status">
        <span>{props.writer.status}</span>
        {props.writer.error ? <span>{props.writer.error}</span> : null}
        {props.writer.draft.dirty ? <button className="btn btn--ghost" onClick={() => void props.writer.flush()}>Retry save</button> : null}
      </div>
      <p id="timeline-export-note" className="timeline-export-note">Timeline projects save non-destructive edit instructions. Rendered video export is not available in Phase 1.</p>

      <TimelinePreview active={active} fileById={fileById} missingIds={missingIds} playing={playing} selectedCompositionItemId={selectedCompositionItemId} onSelectCompositionItem={setSelectedCompositionItemId} onDuration={(clipId, sourceDuration) => {
        const clip = primaryClips(timeline).find((item) => item.clipId === clipId)
        if (!clip || clip.sourceDuration != null || sourceDuration <= 0) return
        commit(updateClip(timeline, clipId, { sourceDuration, sourceEnd: clip.sourceEnd ?? sourceDuration }))
      }} />

      <div className="timeline-transport">
        <button className="btn btn--outline" disabled={!clips.length} onClick={togglePlayback}>{playing ? 'Pause' : 'Play'}</button>
        <span>{formatTime(playhead)} / {formatTime(duration)}</span>
        <button className="btn btn--primary" onClick={() => { setPickerMode('sequence'); props.setPickerOpen(true) }}>+ Media</button>
        <button className="btn btn--outline" onClick={() => { setPickerMode('composition-new'); props.setPickerOpen(true) }}>+ Composition</button>
        <button className="btn btn--ghost" disabled={!history.past.length} onClick={undo}>Undo</button>
        <button className="btn btn--ghost" disabled={!history.future.length} onClick={redo}>Redo</button>
      </div>

      <ProjectTimeline timeline={timeline} fileById={fileById} selectedClipId={selectedClipId} playhead={playhead} zoom={zoom} onZoom={setZoom} onSelect={(clip) => { setSelectedClipId(clip.clipId); setPlayhead(clip.timelineStart) }} onSeek={(time) => { setPlaying(false); setPlayhead(time) }} onReorder={(from, to) => commit(reorderClip(timeline, from, to))} />

      {selected ? <section className="timeline-tools" aria-label="Clip tools">
        <div className="timeline-tools__primary">
          <button className="btn btn--outline" onClick={() => {
            const result = splitClip(timeline, selected.clipId, playhead)
            if (result.rightClipId) { commit(result.timeline); setSelectedClipId(result.rightClipId) }
          }}>Split</button>
          <button className="btn btn--ghost" onClick={() => {
            const result = duplicateClip(timeline, selected.clipId)
            commit(result.timeline); setSelectedClipId(result.clipId)
          }}>Duplicate</button>
          <button className="btn btn--ghost" onClick={() => commit(repeatClip(timeline, selected.clipId, 1))}>Repeat</button>
          <button className="btn btn--ghost" disabled={clips[0]?.clipId === selected.clipId} onClick={() => moveSelected(-1)}>← Move</button>
          <button className="btn btn--ghost" disabled={clips.at(-1)?.clipId === selected.clipId} onClick={() => moveSelected(1)}>Move →</button>
          <button className="btn btn--danger" onClick={() => { commit(deleteClip(timeline, selected.clipId)); setSelectedClipId(null) }}>Delete clip</button>
        </div>

        {selected.mediaType === 'composition' && selected.composition ? <CompositionTools clip={selected} selectedItemId={selectedCompositionItemId} onSelectItem={setSelectedCompositionItemId} onChange={(composition) => commit(updateComposition(timeline, selected.clipId, composition))} onChangeItem={(itemId, patch) => commit(updateCompositionItem(timeline, selected.clipId, itemId, patch))} onRemove={(itemId) => { commit(removeCompositionItem(timeline, selected.clipId, itemId)); setSelectedCompositionItemId(null) }} onAdd={() => { setPickerMode('composition-add'); props.setPickerOpen(true) }} onReplace={() => { setPickerMode('composition-replace'); props.setPickerOpen(true) }} /> : selected.mediaType === 'video' ? <>
          <div className="timeline-tools__range">
            <label>Trim start<input type="range" min={0} max={Math.max(0, sourceEnd(selected) - 0.1)} step={0.05} value={selected.sourceStart} onChange={(event) => applyClip({ sourceStart: Math.min(Number(event.target.value), sourceEnd(selected) - 0.1) })} /></label>
            <label>Trim end<input type="range" min={selected.sourceStart + 0.1} max={selected.sourceDuration ?? sourceEnd(selected)} step={0.05} value={sourceEnd(selected)} onChange={(event) => applyClip({ sourceEnd: Math.max(selected.sourceStart + 0.1, Number(event.target.value)) })} /></label>
          </div>
          <div className="timeline-speed" aria-label="Clip speed">
            {SPEEDS.map((speed) => <button key={speed} className={`btn btn--ghost ${selected.speed === speed ? 'is-on' : ''}`} onClick={() => applyClip({ speed })}>{speed}×</button>)}
            <label>Custom<input className="field-input" type="number" min={0.05} max={8} step={0.05} value={selected.speed} onChange={(event) => applyClip({ speed: Math.min(8, Math.max(0.05, Number(event.target.value) || 1)) })} /></label>
          </div>
          <div className="timeline-tools__range">
            <button className="btn btn--ghost" onClick={() => applyClip({ muted: !selected.muted })}>{selected.muted ? 'Unmute' : 'Mute'}</button>
            <label>Volume<input type="range" min={0} max={1} step={0.05} value={selected.volume} onChange={(event) => applyClip({ volume: Number(event.target.value), muted: Number(event.target.value) === 0 })} /></label>
          </div>
        </> : <label className="timeline-photo-duration">Photo duration<input className="field-input" type="number" min={0.1} step={0.1} value={selected.photoDuration} onChange={(event) => applyClip({ photoDuration: Math.max(0.1, Number(event.target.value) || 3) })} /></label>}

        {selected.mediaType !== 'composition' ? <div className="timeline-tools__range">
          <button className="btn btn--ghost" onClick={() => applyClip({ transform: { ...selected.transform, objectFit: selected.transform.objectFit === 'cover' ? 'contain' : 'cover' } })}>{selected.transform.objectFit === 'cover' ? 'Fit' : 'Fill'}</button>
          <label>Zoom<input type="range" min={1} max={3} step={0.05} value={selected.transform.zoom} onChange={(event) => applyClip({ transform: { ...selected.transform, zoom: Number(event.target.value) } })} /></label>
          <label>Pan X<input type="range" min={-0.4} max={0.4} step={0.01} value={selected.transform.panX} onChange={(event) => applyClip({ transform: { ...selected.transform, panX: Number(event.target.value) } })} /></label>
          <label>Pan Y<input type="range" min={-0.4} max={0.4} step={0.01} value={selected.transform.panY} onChange={(event) => applyClip({ transform: { ...selected.transform, panY: Number(event.target.value) } })} /></label>
        </div> : null}
      </section> : null}
    </main>
    <EditorMediaPicker open={props.pickerOpen} userId={props.user.id} onClose={() => props.setPickerOpen(false)} onAdd={addFiles} projectFileIds={timelineFileIds(timeline)} maxSelect={pickerMode === 'composition-replace' ? 1 : pickerMode.startsWith('composition') ? Math.max(1, 4 - (pickerMode === 'composition-add' ? selected?.composition?.items.length ?? 0 : 0)) : 100} />
  </div>
}

function TimelinePreview({ active, fileById, missingIds, playing, selectedCompositionItemId, onSelectCompositionItem, onDuration }: { active: ReturnType<typeof activeClipAt>; fileById: Record<string, FileRow>; missingIds: Set<string>; playing: boolean; selectedCompositionItemId: string | null; onSelectCompositionItem: (id: string) => void; onDuration: (clipId: string, duration: number) => void }) {
  const clip = active?.clip
  if (clip?.mediaType === 'composition' && clip.composition) return <div className="timeline-preview timeline-preview--composition">
    {clip.composition.items.map((item) => <CompositionPreviewItem key={item.itemId} item={item} file={fileById[item.fileId]} missing={missingIds.has(item.fileId)} localTime={active?.localTime ?? 0} playing={playing} audioPrimary={clip.composition?.audioPrimaryItemId === item.itemId} selected={selectedCompositionItemId === item.itemId} onSelect={() => onSelectCompositionItem(item.itemId)} />)}
  </div>
  return <SingleClipPreview active={active} file={clip?.fileId ? fileById[clip.fileId] : undefined} missing={Boolean(clip?.fileId && missingIds.has(clip.fileId))} playing={playing} onDuration={onDuration} />
}

function SingleClipPreview({ active, file, missing, playing, onDuration }: { active: ReturnType<typeof activeClipAt>; file?: FileRow; missing: boolean; playing: boolean; onDuration: (clipId: string, duration: number) => void }) {
  const clip = active?.clip
  const { displayUrl, loading, failed } = useDecryptedMediaSrc(file?.file_url ?? null, file?.is_encrypted, file?.user_id, file?.file_name ?? '', clip?.fileId ?? undefined)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sourceTime = active?.sourceTime ?? 0

  useEffect(() => {
    const video = videoRef.current
    if (!video || !clip || clip.mediaType !== 'video') return
    if (Math.abs(video.currentTime - sourceTime) > 0.2) {
      try { video.currentTime = sourceTime } catch { /* metadata may still be loading */ }
    }
    video.playbackRate = clip.speed
    video.volume = clip.volume
    video.muted = clip.muted
    if (playing) void video.play().catch(() => {})
    else video.pause()
  }, [clip, playing, sourceTime, displayUrl])

  if (!clip) return <div className="timeline-preview timeline-preview--empty"><span>Add media to begin your timeline.</span></div>
  if (missing) return <div className="timeline-preview timeline-preview--empty"><span>Source unavailable. This clip instruction is preserved.</span></div>
  if (loading || (!displayUrl && !failed)) return <div className="timeline-preview timeline-preview--empty"><span>Loading preview…</span></div>
  if (failed || !displayUrl) return <div className="timeline-preview timeline-preview--empty"><span>Preview unavailable. The source and clip remain unchanged.</span></div>
  const style: CSSProperties = { objectFit: clip.transform.objectFit, transform: `translate(${clip.transform.panX * 100}%, ${clip.transform.panY * 100}%) scale(${clip.transform.zoom})` }
  return <div className="timeline-preview">
    {clip.mediaType === 'video'
      ? <video key={clip.clipId} ref={videoRef} src={displayUrl} playsInline preload="metadata" style={style} onLoadedMetadata={(event) => onDuration(clip.clipId, event.currentTarget.duration)} />
      : <img src={displayUrl} alt={file?.file_name ?? ''} style={style} />}
  </div>
}

function CompositionPreviewItem({ item, file, missing, localTime, playing, audioPrimary, selected, onSelect }: { item: NonNullable<TimelineClip['composition']>['items'][number]; file?: FileRow; missing: boolean; localTime: number; playing: boolean; audioPrimary: boolean; selected: boolean; onSelect: () => void }) {
  const { displayUrl, loading, failed } = useDecryptedMediaSrc(file?.file_url ?? null, file?.is_encrypted, file?.user_id, file?.file_name ?? '', item.fileId)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sourceTime = item.sourceStart + localTime * item.speed
  useEffect(() => {
    const video = videoRef.current
    if (!video || item.mediaType !== 'video') return
    const end = item.sourceEnd ?? item.sourceDuration ?? Number.POSITIVE_INFINITY
    const time = Math.min(Math.max(item.sourceStart, sourceTime), end)
    if (Math.abs(video.currentTime - time) > .25) { try { video.currentTime = time } catch { /* metadata pending */ } }
    video.playbackRate = item.speed; video.volume = item.volume; video.muted = item.muted || !audioPrimary
    if (playing) void video.play().catch(() => {}); else video.pause()
  }, [audioPrimary, displayUrl, item, playing, sourceTime])
  const t = item.transform
  const frame: CSSProperties = { left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.width * 100}%`, height: `${t.height * 100}%` }
  const mediaStyle: CSSProperties = { objectFit: t.objectFit, transform: `translate(${t.panX * 100}%, ${t.panY * 100}%) scale(${t.zoom})` }
  return <button type="button" className={`composition-item ${selected ? 'is-selected' : ''}`} style={frame} onClick={onSelect} aria-label={`Edit ${file?.file_name ?? 'composition item'}`}>
    {missing ? <span>Source unavailable</span> : loading ? <span>Loading…</span> : failed || !displayUrl ? <span>Preview unavailable</span> : item.mediaType === 'video' ? <video ref={videoRef} src={displayUrl} playsInline preload="metadata" style={mediaStyle} /> : <img src={displayUrl} alt="" style={mediaStyle} />}
  </button>
}

function CompositionTools({ clip, selectedItemId, onSelectItem, onChange, onChangeItem, onRemove, onAdd, onReplace }: { clip: TimelineClip; selectedItemId: string | null; onSelectItem: (id: string) => void; onChange: (patch: Partial<NonNullable<TimelineClip['composition']>>) => void; onChangeItem: (id: string, patch: Partial<NonNullable<TimelineClip['composition']>['items'][number]>) => void; onRemove: (id: string) => void; onAdd: () => void; onReplace: () => void }) {
  const composition = clip.composition!
  const item = composition.items.find((entry) => entry.itemId === selectedItemId) ?? composition.items[0]
  const layouts: Array<{ id: CompositionLayout; label: string }> = [{ id: 'horizontal', label: '2 side' }, { id: 'vertical', label: '2 stack' }, { id: 'three', label: '3' }, { id: 'grid', label: '4 grid' }, { id: 'free', label: 'Free' }]
  return <div className="composition-tools">
    <div className="timeline-speed">{layouts.map(({ id, label }) => <button key={id} className={`btn btn--ghost ${composition.layout === id ? 'is-on' : ''}`} onClick={() => onChange(applyCompositionLayout(composition, id))}>{label}</button>)}</div>
    <div className="timeline-tools__primary">
      {composition.items.map((entry, index) => <button key={entry.itemId} className={`btn btn--ghost ${item?.itemId === entry.itemId ? 'is-on' : ''}`} onClick={() => onSelectItem(entry.itemId)}>Cell {index + 1}</button>)}
      <button className="btn btn--outline" disabled={composition.items.length >= 4} onClick={onAdd}>Add cell</button>
      <button className="btn btn--ghost" disabled={!item} onClick={onReplace}>Replace</button>
      <button className="btn btn--danger" disabled={!item} onClick={() => item && onRemove(item.itemId)}>Remove cell</button>
    </div>
    <label className="timeline-photo-duration">Composition duration<input className="field-input" type="number" min={.1} step={.1} value={composition.duration} onChange={(event) => onChange({ duration: Math.max(.1, Number(event.target.value) || 5) })} /></label>
    {item ? <>
      <div className="timeline-tools__range">
        <button className="btn btn--ghost" onClick={() => onChangeItem(item.itemId, { transform: { ...item.transform, objectFit: item.transform.objectFit === 'cover' ? 'contain' : 'cover' } })}>{item.transform.objectFit === 'cover' ? 'Fit' : 'Fill'}</button>
        <label>Zoom<input type="range" min={1} max={5} step={.05} value={item.transform.zoom} onChange={(event) => onChangeItem(item.itemId, { transform: { ...item.transform, zoom: Number(event.target.value) } })} /></label>
        <label>Pan X<input type="range" min={-1} max={1} step={.01} value={item.transform.panX} onChange={(event) => onChangeItem(item.itemId, { transform: { ...item.transform, panX: Number(event.target.value) } })} /></label>
        <label>Pan Y<input type="range" min={-1} max={1} step={.01} value={item.transform.panY} onChange={(event) => onChangeItem(item.itemId, { transform: { ...item.transform, panY: Number(event.target.value) } })} /></label>
      </div>
      {composition.layout === 'free' ? <div className="timeline-tools__range">
        {(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input type="range" min={0} max={1} step={.01} value={item.transform[key]} onChange={(event) => onChangeItem(item.itemId, { transform: { ...item.transform, [key]: Number(event.target.value) } })} /></label>)}
      </div> : null}
      {item.mediaType === 'video' ? <>
        <div className="timeline-tools__range"><label>Trim start<input type="range" min={0} max={Math.max(0, (item.sourceEnd ?? item.sourceDuration ?? 5) - .1)} step={.05} value={item.sourceStart} onChange={(event) => onChangeItem(item.itemId, { sourceStart: Math.min(Number(event.target.value), (item.sourceEnd ?? item.sourceDuration ?? 5) - .1) })} /></label><label>Trim end<input type="range" min={item.sourceStart + .1} max={item.sourceDuration ?? item.sourceEnd ?? 5} step={.05} value={item.sourceEnd ?? item.sourceDuration ?? 5} onChange={(event) => onChangeItem(item.itemId, { sourceEnd: Math.max(item.sourceStart + .1, Number(event.target.value)) })} /></label><label>Speed<input className="field-input" type="number" min={.05} max={8} step={.05} value={item.speed} onChange={(event) => onChangeItem(item.itemId, { speed: Math.min(8, Math.max(.05, Number(event.target.value) || 1)) })} /></label></div>
        <div className="timeline-tools__range"><button className="btn btn--ghost" onClick={() => onChange({ audioPrimaryItemId: item.itemId })}>{composition.audioPrimaryItemId === item.itemId ? 'Audio primary ✓' : 'Use this audio'}</button><button className="btn btn--ghost" onClick={() => onChangeItem(item.itemId, { muted: !item.muted })}>{item.muted ? 'Unmute' : 'Mute'}</button><label>Volume<input type="range" min={0} max={1} step={.05} value={item.volume} onChange={(event) => onChangeItem(item.itemId, { volume: Number(event.target.value) })} /></label></div>
      </> : null}
    </> : null}
  </div>
}

function ProjectTimeline(props: {
  timeline: TimelineDocument
  fileById: Record<string, FileRow>
  selectedClipId: string | null
  playhead: number
  zoom: number
  onZoom: (zoom: number) => void
  onSelect: (clip: TimelineClip) => void
  onSeek: (time: number) => void
  onReorder: (from: number, to: number) => void
}) {
  const clips = primaryClips(props.timeline)
  const duration = timelineDuration(props.timeline)
  const pxPerSecond = 42 * props.zoom
  const width = Math.max(320, duration * pxPerSecond)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const tickEvery = duration > 180 ? 30 : duration > 60 ? 10 : duration > 20 ? 5 : 1
  const ticks = Array.from({ length: Math.floor(duration / tickEvery) + 1 }, (_, index) => index * tickEvery)
  return <section className="project-timeline" aria-label="Project timeline">
    <div className="project-timeline__header"><strong>Timeline</strong><label>Zoom<input type="range" min={0.5} max={3} step={0.25} value={props.zoom} onChange={(event) => props.onZoom(Number(event.target.value))} /></label></div>
    <div ref={scrollRef} className="project-timeline__scroll">
      <div className="project-timeline__content" style={{ width }} onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('.project-clip')) return
        const rect = event.currentTarget.getBoundingClientRect()
        props.onSeek(Math.min(duration, Math.max(0, (event.clientX - rect.left) / pxPerSecond)))
      }}>
        <div className="project-timeline__ruler">{ticks.map((tick) => <span key={tick} style={{ left: tick * pxPerSecond }}>{formatTime(tick)}</span>)}</div>
        <div className="project-timeline__track">
          {clips.map((clip, index) => {
            const representativeId = clipFileIds(clip)[0]
            const file = representativeId ? props.fileById[representativeId] : undefined
            const clipWidth = Math.max(72, clipDuration(clip) * pxPerSecond)
            return <button key={clip.clipId} type="button" draggable className={`project-clip project-clip--${clip.mediaType} ${props.selectedClipId === clip.clipId ? 'is-selected' : ''}`} style={{ width: clipWidth }} onClick={() => props.onSelect(clip)} onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex != null) props.onReorder(dragIndex, index); setDragIndex(null) }}>
              {file ? <span className="project-clip__thumb" aria-hidden><VaultPhotoTileMedia file={file} userId={file.user_id} /></span> : null}
              <span className="project-clip__type">{clip.mediaType === 'composition' ? 'COMP' : clip.mediaType === 'video' ? 'VID' : 'PHOTO'}</span>
              <span className="project-clip__name">{clip.mediaType === 'composition' ? `Composition · ${clip.composition?.items.length ?? 0} media` : file?.file_name ?? 'Missing source'}</span>
              <span className="project-clip__duration">{formatTime(clipDuration(clip))}</span>
            </button>
          })}
        </div>
        <div className="project-timeline__playhead" style={{ left: props.playhead * pxPerSecond }}><span /></div>
      </div>
    </div>
  </section>
}
