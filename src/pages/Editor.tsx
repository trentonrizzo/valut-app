import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { listMediaPage } from '../lib/mediaQueries'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'
import type { FileRow } from '../types/media'
import { classifyFileKind } from '../lib/fileKind'
import {
  deleteEditorProject,
  emptyPayload,
  exportSupported,
  listEditorProjects,
  saveEditorProject,
  type EditorProject,
  type EditorProjectPayload,
  type EditorSlot,
} from '../lib/editor/projects'
import { exportEditorCollageToVault } from '../lib/editor/exportToVault'
import { useDecryptedMediaSrc } from '../hooks/useDecryptedMediaSrc'
import { VaultPhotoTileMedia } from '../components/files/VaultPhotoTile'
import { useVault } from '../context/useVault'

const LAYOUTS: { id: EditorProjectPayload['layout']; label: string }[] = [
  { id: '1', label: '1' },
  { id: '1x2', label: '2 across' },
  { id: '2x1', label: '2 stacked' },
  { id: '1+2', label: '3' },
  { id: '2x2', label: '2×2' },
]

export function Editor() {
  const { user, session } = useAuth()
  const { masterKey } = useVault()
  const { showToast } = useToast()
  const [projects, setProjects] = useState<EditorProject[]>([])
  const [title, setTitle] = useState('Untitled')
  const [payload, setPayload] = useState<EditorProjectPayload>(emptyPayload('2x2'))
  const [projectId, setProjectId] = useState<string | undefined>()
  const [picker, setPicker] = useState<FileRow[]>([])
  const [pickerCursor, setPickerCursor] = useState<{ ts: string | null; id: string; num: number | null } | null>(null)
  const [slotIndex, setSlotIndex] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [fileById, setFileById] = useState<Record<string, FileRow>>({})
  const [exporting, setExporting] = useState(false)
  const exportCaps = useMemo(() => exportSupported(), [])

  useEffect(() => {
    if (!user) return
    void listEditorProjects(user.id).then(setProjects).catch((e) => showToast(e instanceof Error ? e.message : 'Could not load projects', 'error'))
    void listMediaPage({ userId: user.id, filters: DEFAULT_MEDIA_FILTERS, limit: 48 })
      .then((p) => {
        setPicker(p.rows)
        setPickerCursor(p.nextCursor)
        setFileById((prev) => {
          const next = { ...prev }
          for (const r of p.rows) next[r.id] = r
          return next
        })
      })
      .catch(() => {})
  }, [user, showToast])

  // Autosave project payload (debounced). Leaving Editor does not erase work.
  useEffect(() => {
    if (!user || !projectId) return
    const kind =
      payload.slots.filter((s) => s.kind === 'video').length === 1 && payload.slots.length === 1 ? 'video' : 'collage'
    const t = window.setTimeout(() => {
      void saveEditorProject(user.id, { id: projectId, title, kind, payload })
        .then((saved) => {
          setProjects((prev) => {
            const i = prev.findIndex((p) => p.id === saved.id)
            if (i < 0) return [saved, ...prev]
            const next = prev.slice()
            next[i] = saved
            return next
          })
        })
        .catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [user, projectId, title, payload])

  useEffect(() => {
    if (!user) return
    const missing = payload.slots
      .map((s) => s.fileId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && !fileById[id])
    if (missing.length === 0) return
    void supabase
      .from('files')
      .select('*')
      .eq('user_id', user.id)
      .in('id', missing)
      .then(({ data }) => {
        if (!data) return
        setFileById((prev) => {
          const next = { ...prev }
          for (const row of data as FileRow[]) next[row.id] = row
          return next
        })
      })
  }, [payload.slots, user, fileById])

  function setLayout(layout: EditorProjectPayload['layout']) {
    const next = emptyPayload(layout)
    next.slots = next.slots.map((s, i) => payload.slots[i] ?? s)
    setPayload(next)
  }

  function updateSlot(index: number, patch: Partial<EditorSlot>) {
    const slots = payload.slots.slice()
    slots[index] = { ...slots[index]!, ...patch }
    setPayload({ ...payload, slots })
  }

  async function save() {
    if (!user) return
    try {
      const saved = await saveEditorProject(user.id, {
        id: projectId,
        title,
        kind: payload.slots.filter((s) => s.kind === 'video').length === 1 && payload.slots.length === 1 ? 'video' : 'collage',
        payload,
      })
      setProjectId(saved.id)
      setProjects((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)])
      showToast('Project saved. Originals were not changed.')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error')
    }
  }

  async function exportNew() {
    if (!user || !session?.access_token) return
    setExporting(true)
    try {
      const result = await exportEditorCollageToVault({
        title,
        payload,
        accessToken: session.access_token,
        albumId: null,
        fileById,
        masterKey,
      })
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }
      showToast(`Export queued as new file “${result.fileName}”. Originals untouched; ready after verify.`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  function chooseFile(file: FileRow) {
    if (slotIndex == null) return
    const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
    if (kind !== 'image' && kind !== 'video') return
    setFileById((prev) => ({ ...prev, [file.id]: file }))
    updateSlot(slotIndex, {
      fileId: file.id,
      kind,
      muted: kind === 'video' ? slotIndex !== payload.audioMasterIndex : true,
    })
    setPickerOpen(false)
  }

  return (
    <div className="dashboard editor-page">
      <main className="dashboard__main">
        <div className="dashboard__toolbar">
          <div>
            <h1 className="dashboard__title">Editor</h1>
            <p className="dashboard__subtitle">Non-destructive collage. Originals stay untouched.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Save project
          </button>
          <button
            type="button"
            className="btn btn--outline"
            disabled={exporting || !exportCaps.canvas}
            onClick={() => void exportNew()}
          >
            {exporting ? 'Exporting…' : 'Export as new'}
          </button>
        </div>
        <div className="library-controls__row">
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Project title" />
        </div>
        <div className="library-controls__row">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`btn btn--ghost ${payload.layout === l.id ? 'is-on' : ''}`}
              onClick={() => setLayout(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className={`editor-canvas editor-canvas--${payload.layout === '1+2' ? 'plus' : payload.layout}`}>
          {payload.slots.map((slot, i) => (
            <button
              key={i}
              type="button"
              className={`editor-slot ${slotIndex === i ? 'is-on' : ''}`}
              onClick={() => {
                setSlotIndex(i)
                if (!slot.fileId) setPickerOpen(true)
              }}
            >
              {slot.fileId ? (
                <EditorSlotPreview file={fileById[slot.fileId]} fileId={slot.fileId} objectFit={slot.objectFit} />
              ) : (
                <span>Tap to choose media</span>
              )}
            </button>
          ))}
        </div>
        {slotIndex != null && payload.slots[slotIndex] ? (
          <EditorSlotTools
            slot={payload.slots[slotIndex]!}
            file={payload.slots[slotIndex]!.fileId ? fileById[payload.slots[slotIndex]!.fileId!] : undefined}
            onChange={(patch) => updateSlot(slotIndex, patch)}
            onReplace={() => setPickerOpen(true)}
            onRemove={() => updateSlot(slotIndex, emptyPayload().slots[0]!)}
            onAudioMaster={() => setPayload({ ...payload, audioMasterIndex: slotIndex })}
          />
        ) : null}
        {pickerOpen ? (
          <div className="sheet-root">
            <button type="button" className="sheet-backdrop" aria-label="Close picker" onClick={() => setPickerOpen(false)} />
            <div className="sheet sheet--tall" role="dialog" aria-label="Choose media">
              <div className="sheet__handle" />
              <h2 className="sheet__title">Choose media</h2>
              <div className="editor-picker-grid">
                {picker.map((f) => {
                  const kind = classifyFileKind({ name: f.file_name, mime_type: f.mime_type })
                  if (kind !== 'image' && kind !== 'video') return null
                  return (
                    <button key={f.id} type="button" className="editor-picker-tile" onClick={() => chooseFile(f)}>
                      {user ? <VaultPhotoTileMedia file={f} userId={user.id} /> : null}
                    </button>
                  )
                })}
              </div>
              {pickerCursor ? (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => {
                    if (!user) return
                    void listMediaPage({ userId: user.id, filters: DEFAULT_MEDIA_FILTERS, cursor: pickerCursor, limit: 48 }).then((p) => {
                      setPicker((prev) => [...prev, ...p.rows])
                      setPickerCursor(p.nextCursor)
                      setFileById((prev) => {
                        const next = { ...prev }
                        for (const r of p.rows) next[r.id] = r
                        return next
                      })
                    })
                  }}
                >
                  Load more
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="dashboard__subtitle">
          Export as new creates a JPEG collage via the normal upload + verify path. Originals are never overwritten.
          {exportCaps.mediaRecorder
            ? ' Video collage export is not enabled yet — save the project instead.'
            : ' MediaRecorder unavailable; image export still works when canvas is available.'}
        </p>
        <h2 className="settings-section__heading">Saved projects</h2>
        <ul className="deleted-list">
          {projects.map((p) => (
            <li key={p.id} className="deleted-row">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setProjectId(p.id)
                  setTitle(p.title)
                  setPayload(p.payload)
                }}
              >
                {p.title}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (!user) return
                  void deleteEditorProject(user.id, p.id).then(() => setProjects((prev) => prev.filter((x) => x.id !== p.id)))
                }}
              >
                Delete project
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

function EditorSlotPreview({
  file,
  fileId,
  objectFit,
}: {
  file?: FileRow
  fileId: string
  objectFit: 'cover' | 'contain'
}) {
  const { displayUrl, loading, failed } = useDecryptedMediaSrc(
    file?.file_url ?? null,
    file?.is_encrypted,
    file?.user_id ?? null,
    file?.file_name ?? '',
    fileId,
  )
  const kind = classifyFileKind({ name: file?.file_name, mime_type: file?.mime_type })
  if (loading || (!displayUrl && !failed)) return <div className="editor-slot__skeleton" aria-hidden />
  if (failed || !displayUrl) return <span>Could not load preview</span>
  if (kind === 'video' || file?.mime_type?.startsWith('video/')) {
    return <video src={displayUrl} muted playsInline preload="metadata" style={{ objectFit }} />
  }
  return <img src={displayUrl} alt="" style={{ objectFit }} />
}

function EditorSlotTools({
  slot,
  file,
  onChange,
  onReplace,
  onRemove,
  onAudioMaster,
}: {
  slot: EditorSlot
  file?: FileRow
  onChange: (patch: Partial<EditorSlot>) => void
  onReplace: () => void
  onRemove: () => void
  onAudioMaster: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { displayUrl } = useDecryptedMediaSrc(file?.file_url ?? null, file?.is_encrypted, file?.user_id ?? null, file?.file_name ?? '', slot.fileId)
  const isVideo = slot.kind === 'video'

  return (
    <div className="editor-tools">
      <div className="library-controls__row">
        <button type="button" className="btn btn--outline" onClick={onReplace}>
          Replace
        </button>
        <button type="button" className="btn btn--ghost" onClick={onRemove}>
          Remove
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => onChange({ objectFit: slot.objectFit === 'cover' ? 'contain' : 'cover' })}
        >
          {slot.objectFit === 'cover' ? 'Fill' : 'Fit'}
        </button>
      </div>
      {isVideo && displayUrl ? (
        <div className="editor-video-tools">
          <video
            ref={videoRef}
            src={displayUrl}
            muted={slot.muted}
            playsInline
            controls={false}
            preload="metadata"
            className="editor-video-tools__preview"
          />
          <div className="library-controls__row">
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => {
                const el = videoRef.current
                if (!el) return
                if (el.paused) void el.play().catch(() => {})
                else el.pause()
              }}
            >
              Play / Pause
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => onChange({ muted: !slot.muted })}>
              {slot.muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onAudioMaster}>
              Audio master
            </button>
          </div>
          <label className="filter-bar__num">
            Scrub
            <input
              className="field-input"
              type="range"
              min={0}
              max={1000}
              defaultValue={0}
              onChange={(e) => {
                const el = videoRef.current
                if (!el || !Number.isFinite(el.duration)) return
                el.currentTime = (Number(e.target.value) / 1000) * el.duration
              }}
            />
          </label>
          <label className="filter-bar__num">
            Trim start (s)
            <input
              className="field-input"
              type="number"
              min={0}
              value={slot.trimStart}
              onChange={(e) => onChange({ trimStart: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="filter-bar__num">
            Trim end (s)
            <input
              className="field-input"
              type="number"
              min={0}
              value={slot.trimEnd ?? ''}
              onChange={(e) => onChange({ trimEnd: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
