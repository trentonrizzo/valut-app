import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { useVault } from '../context/useVault'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../types/media'
import { classifyFileKind } from '../lib/fileKind'
import {
  LAYOUTS,
  activeScene,
  deleteEditorProject,
  duplicateEditorProject,
  emptyLayer,
  emptyPayload,
  emptyScene,
  exportSupported,
  inferProjectKind,
  layersForLayout,
  listEditorProjects,
  normalizePayload,
  projectDurationSec,
  projectMediaCount,
  saveEditorProject,
  type EditorLayer,
  type EditorLayout,
  type EditorProject,
  type EditorProjectPayload,
  type EditorScene,
} from '../lib/editor/projects'
import { exportEditorCollageToVault } from '../lib/editor/exportToVault'
import { useDecryptedMediaSrc } from '../hooks/useDecryptedMediaSrc'
import { EditorMediaPicker } from '../components/editor/EditorMediaPicker'
import { EditorTimeline } from '../components/editor/EditorTimeline'

type Mode = 'home' | 'edit'

const SPEEDS = [0.5, 1, 1.5, 2]

export function Editor() {
  const { user, session } = useAuth()
  const { masterKey } = useVault()
  const { showToast } = useToast()
  const [mode, setMode] = useState<Mode>('home')
  const [projects, setProjects] = useState<EditorProject[]>([])
  const [title, setTitle] = useState('Untitled')
  const [payload, setPayload] = useState<EditorProjectPayload>(() => emptyPayload('1'))
  const [projectId, setProjectId] = useState<string | undefined>()
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'fill-empty' | 'replace'>('fill-empty')
  const [fileById, setFileById] = useState<Record<string, FileRow>>({})
  const [exporting, setExporting] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [seekTime, setSeekTime] = useState(0)
  const [sourceDuration, setSourceDuration] = useState(0)
  const exportCaps = useMemo(() => exportSupported(), [])
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})

  const scene = activeScene(payload)
  const selectedLayer = scene.layers.find((l) => l.id === selectedLayerId) ?? scene.layers.find((l) => l.fileId) ?? null

  useEffect(() => {
    if (!user) return
    void listEditorProjects(user.id)
      .then(setProjects)
      .catch((e) => showToast(e instanceof Error ? e.message : 'Could not load projects', 'error'))
  }, [user, showToast])

  // Autosave — create row on first edit if needed (debounced).
  useEffect(() => {
    if (!user || mode !== 'edit') return
    const kind = inferProjectKind(payload)
    const t = window.setTimeout(() => {
      void saveEditorProject(user.id, { id: projectId, title: title || 'Untitled', kind, payload })
        .then((saved) => {
          setProjectId(saved.id)
          setProjects((prev) => {
            const i = prev.findIndex((p) => p.id === saved.id)
            if (i < 0) return [saved, ...prev]
            const next = prev.slice()
            next[i] = saved
            return next
          })
        })
        .catch(() => {})
    }, 900)
    return () => window.clearTimeout(t)
  }, [user, mode, projectId, title, payload])

  useEffect(() => {
    if (!user) return
    const ids = payload.scenes
      .flatMap((s) => s.layers.map((l) => l.fileId))
      .filter((id): id is string => Boolean(id && !fileById[id]))
    if (!ids.length) return
    void supabase
      .from('files')
      .select('*')
      .eq('user_id', user.id)
      .in('id', ids)
      .then(({ data }) => {
        if (!data) return
        setFileById((prev) => {
          const next = { ...prev }
          for (const row of data as FileRow[]) next[row.id] = row
          return next
        })
      })
  }, [payload, user, fileById])

  function updatePayload(mutator: (p: EditorProjectPayload) => EditorProjectPayload) {
    setPayload((prev) => normalizePayload(mutator(prev)))
  }

  function updateScene(mutator: (s: EditorScene) => EditorScene) {
    updatePayload((p) => ({
      ...p,
      scenes: p.scenes.map((s) => (s.id === p.activeSceneId ? mutator(s) : s)),
    }))
  }

  function updateLayer(layerId: string, patch: Partial<EditorLayer>) {
    updateScene((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
    }))
  }

  function setLayout(layout: EditorLayout) {
    updateScene((s) => ({ ...s, layout, layers: layersForLayout(layout, s.layers) }))
  }

  function openNewProject() {
    const p = emptyPayload('1')
    setPayload(p)
    setTitle('Untitled')
    setProjectId(undefined)
    setSelectedLayerId(p.scenes[0]?.layers[0]?.id ?? null)
    setMode('edit')
    setPickerOpen(true)
    setPickerMode('fill-empty')
  }

  function openProject(p: EditorProject) {
    const normalized = normalizePayload(p.payload)
    setPayload(normalized)
    setTitle(p.title)
    setProjectId(p.id)
    setSelectedLayerId(activeScene(normalized).layers.find((l) => l.fileId)?.id ?? activeScene(normalized).layers[0]?.id ?? null)
    setMode('edit')
  }

  function addFilesToScene(files: FileRow[]) {
    setFileById((prev) => {
      const next = { ...prev }
      for (const f of files) next[f.id] = f
      return next
    })
    updateScene((s) => {
      const layers = s.layers.slice()
      let fi = 0
      if (pickerMode === 'replace' && selectedLayerId) {
        const idx = layers.findIndex((l) => l.id === selectedLayerId)
        const file = files[0]
        if (idx >= 0 && file) {
          const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
          if (kind === 'image' || kind === 'video') {
            layers[idx] = {
              ...layers[idx]!,
              fileId: file.id,
              kind,
              muted: true,
              trimStart: 0,
              trimEnd: null,
            }
          }
        }
        return { ...s, layers }
      }
      for (let i = 0; i < layers.length && fi < files.length; i++) {
        if (layers[i]!.fileId) continue
        const file = files[fi++]!
        const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
        if (kind !== 'image' && kind !== 'video') continue
        layers[i] = {
          ...layers[i]!,
          fileId: file.id,
          kind,
          muted: true,
          trimStart: 0,
          trimEnd: null,
          photoDuration: 3,
        }
      }
      // If still files left and layout can grow up to 4, expand layout.
      while (fi < files.length && layers.length < 4) {
        const file = files[fi++]!
        const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
        if (kind !== 'image' && kind !== 'video') continue
        layers.push({
          ...emptyLayer(),
          fileId: file.id,
          kind,
          muted: true,
        })
      }
      const layout: EditorLayout =
        layers.length <= 1 ? '1' : layers.length === 2 ? s.layout === '2x1' ? '2x1' : '1x2' : layers.length === 3 ? '1+2' : '2x2'
      const fitted = layersForLayout(layout, layers)
      return { ...s, layout, layers: fitted }
    })
    setPickerOpen(false)
    showToast(`Added ${files.length} to project · originals untouched`)
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
      showToast(`Exported “${result.fileName}” as new Vault media`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  function togglePlay() {
    const next = !playing
    setPlaying(next)
    for (const layer of scene.layers) {
      const el = videoRefs.current[layer.id]
      if (!el) continue
      if (next) {
        el.currentTime = Math.max(layer.trimStart, el.currentTime)
        void el.play().catch(() => {})
      } else el.pause()
    }
  }

  if (mode === 'home') {
    return (
      <div className="dashboard editor-page editor-page--home">
        <main className="dashboard__main">
          <div className="dashboard__toolbar">
            <div>
              <h1 className="dashboard__title">Editor</h1>
              <p className="dashboard__subtitle">Projects autosave. Originals never change.</p>
            </div>
            <button type="button" className="btn btn--primary" onClick={openNewProject}>
              New project
            </button>
          </div>
          <h2 className="settings-section__heading">Saved projects</h2>
          {projects.length === 0 ? (
            <div className="vault-empty">No projects yet. Start one with New project.</div>
          ) : (
            <ul className="editor-project-list">
              {projects.map((p) => {
                const media = projectMediaCount(p.payload)
                const dur = projectDurationSec(p.payload)
                return (
                  <li key={p.id} className="editor-project-card">
                    <button type="button" className="editor-project-card__main" onClick={() => openProject(p)}>
                      <strong>{p.title || 'Untitled'}</strong>
                      <span className="muted">
                        {media} media · {p.payload.scenes.length} scene{p.payload.scenes.length === 1 ? '' : 's'}
                        {dur > 0 ? ` · ~${Math.round(dur)}s` : ''} · {new Date(p.updated_at).toLocaleString()}
                      </span>
                    </button>
                    <div className="editor-project-card__actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          if (!user) return
                          void duplicateEditorProject(user.id, p).then((d) => {
                            setProjects((prev) => [d, ...prev])
                            showToast('Duplicated')
                          })
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          if (!user) return
                          if (!window.confirm(`Delete project “${p.title}”? Source Vault media is kept.`)) return
                          void deleteEditorProject(user.id, p.id).then(() => {
                            setProjects((prev) => prev.filter((x) => x.id !== p.id))
                            showToast('Project deleted')
                          })
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="dashboard editor-page editor-page--workspace">
      <main className="dashboard__main editor-workspace">
        <div className="editor-workspace__bar">
          <button type="button" className="btn btn--ghost" onClick={() => setMode('home')}>
            Projects
          </button>
          <input
            className="field-input editor-workspace__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Project name"
          />
          <button type="button" className="btn btn--outline" disabled={exporting || !exportCaps.canvas} onClick={() => void exportNew()}>
            {exporting ? '…' : 'Export'}
          </button>
        </div>

        <div className={`editor-canvas editor-canvas--${scene.layout === '1+2' ? 'plus' : scene.layout}`}>
          {scene.layers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              className={`editor-slot ${selectedLayerId === layer.id ? 'is-on' : ''}`}
              onClick={() => {
                setSelectedLayerId(layer.id)
                if (!layer.fileId) {
                  setPickerMode('fill-empty')
                  setPickerOpen(true)
                }
              }}
            >
              {layer.fileId ? (
                <EditorLayerPreview
                  file={fileById[layer.fileId]}
                  layer={layer}
                  playing={playing}
                  audioMaster={payload.audioMasterLayerId === layer.id}
                  videoRef={(el) => {
                    videoRefs.current[layer.id] = el
                  }}
                  onDuration={(d) => {
                    if (layer.id === selectedLayer?.id) setSourceDuration(d)
                  }}
                  onTime={(t) => {
                    if (layer.id === selectedLayer?.id) setSeekTime(t)
                  }}
                />
              ) : (
                <span className="editor-slot__empty">Tap to add</span>
              )}
            </button>
          ))}
        </div>

        <div className="editor-workspace__transport">
          <button type="button" className="btn btn--outline" onClick={togglePlay}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setPickerMode('fill-empty')
              setPickerOpen(true)
            }}
          >
            Add media
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              const s = emptyScene(scene.layout)
              updatePayload((p) => ({
                ...p,
                scenes: [...p.scenes, s],
                activeSceneId: s.id,
              }))
              setSelectedLayerId(s.layers[0]?.id ?? null)
            }}
          >
            + Scene
          </button>
        </div>

        <div className="editor-scene-strip" aria-label="Scenes">
          {payload.scenes.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className={`editor-scene-chip ${s.id === payload.activeSceneId ? 'is-active' : ''}`}
              onClick={() => {
                updatePayload((p) => ({ ...p, activeSceneId: s.id }))
                setSelectedLayerId(s.layers.find((l) => l.fileId)?.id ?? s.layers[0]?.id ?? null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                if (payload.scenes.length <= 1) return
                if (!window.confirm('Remove this scene from the project?')) return
                updatePayload((p) => {
                  const scenes = p.scenes.filter((x) => x.id !== s.id)
                  return { ...p, scenes, activeSceneId: scenes[0]!.id }
                })
              }}
            >
              Scene {idx + 1}
            </button>
          ))}
        </div>

        <div className="library-controls__row editor-layouts">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`btn btn--ghost ${scene.layout === l.id ? 'is-on' : ''}`}
              onClick={() => setLayout(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>

        {selectedLayer ? (
          <div className="editor-tools">
            <div className="library-controls__row">
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => {
                  setPickerMode('replace')
                  setPickerOpen(true)
                }}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => updateLayer(selectedLayer.id, { ...emptyLayer(), id: selectedLayer.id })}
              >
                Remove
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  updateLayer(selectedLayer.id, {
                    objectFit: selectedLayer.objectFit === 'cover' ? 'contain' : 'cover',
                  })
                }
              >
                {selectedLayer.objectFit === 'cover' ? 'Fit' : 'Fill'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => updateLayer(selectedLayer.id, { zoom: 1, panX: 0, panY: 0 })}
              >
                Reset view
              </button>
            </div>

            <div className="editor-tools__gestures">
              <label>
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={selectedLayer.zoom}
                  onChange={(e) => updateLayer(selectedLayer.id, { zoom: Number(e.target.value) })}
                />
              </label>
              <label>
                Pan X
                <input
                  type="range"
                  min={-0.4}
                  max={0.4}
                  step={0.01}
                  value={selectedLayer.panX}
                  onChange={(e) => updateLayer(selectedLayer.id, { panX: Number(e.target.value) })}
                />
              </label>
              <label>
                Pan Y
                <input
                  type="range"
                  min={-0.4}
                  max={0.4}
                  step={0.01}
                  value={selectedLayer.panY}
                  onChange={(e) => updateLayer(selectedLayer.id, { panY: Number(e.target.value) })}
                />
              </label>
            </div>

            {selectedLayer.kind === 'video' ? (
              <>
                <EditorTimeline
                  layer={selectedLayer}
                  duration={sourceDuration || Math.max(selectedLayer.trimEnd ?? 0, selectedLayer.trimStart + 1)}
                  currentTime={seekTime}
                  onChange={(patch) => updateLayer(selectedLayer.id, patch)}
                  onSeek={(t) => {
                    setSeekTime(t)
                    const el = videoRefs.current[selectedLayer.id]
                    if (el) el.currentTime = t
                  }}
                />
                <div className="library-controls__row">
                  {SPEEDS.map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      className={`btn btn--ghost ${selectedLayer.speed === sp ? 'is-on' : ''}`}
                      onClick={() => {
                        updateLayer(selectedLayer.id, { speed: sp })
                        const el = videoRefs.current[selectedLayer.id]
                        if (el) el.playbackRate = sp
                      }}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
                <div className="library-controls__row">
                  <button
                    type="button"
                    className="btn btn--outline"
                    onClick={() => updateLayer(selectedLayer.id, { muted: !selectedLayer.muted })}
                  >
                    {selectedLayer.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() =>
                      updatePayload((p) => ({
                        ...p,
                        audioMasterLayerId: selectedLayer.id,
                        scenes: p.scenes.map((sc) => ({
                          ...sc,
                          layers: sc.layers.map((l) => ({
                            ...l,
                            muted: l.id === selectedLayer.id ? false : true,
                          })),
                        })),
                      }))
                    }
                  >
                    Solo audio
                  </button>
                  <label className="editor-volume">
                    Vol
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={selectedLayer.volume}
                      onChange={(e) => {
                        const volume = Number(e.target.value)
                        updateLayer(selectedLayer.id, { volume, muted: volume === 0 })
                        const el = videoRefs.current[selectedLayer.id]
                        if (el) el.volume = volume
                      }}
                    />
                  </label>
                </div>
              </>
            ) : selectedLayer.kind === 'image' ? (
              <label className="filter-bar__num">
                Photo duration (s)
                <input
                  className="field-input"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={selectedLayer.photoDuration}
                  onChange={(e) => updateLayer(selectedLayer.id, { photoDuration: Math.max(0.5, Number(e.target.value) || 3) })}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </main>

      {user ? (
        <EditorMediaPicker
          open={pickerOpen}
          userId={user.id}
          onClose={() => setPickerOpen(false)}
          onAdd={addFilesToScene}
          maxSelect={pickerMode === 'replace' ? 1 : 4}
        />
      ) : null}
    </div>
  )
}

function EditorLayerPreview({
  file,
  layer,
  audioMaster,
  videoRef,
  onDuration,
  onTime,
}: {
  file?: FileRow
  layer: EditorLayer
  playing: boolean
  audioMaster: boolean
  videoRef: (el: HTMLVideoElement | null) => void
  onDuration: (d: number) => void
  onTime: (t: number) => void
}) {
  const { displayUrl, loading, failed } = useDecryptedMediaSrc(
    file?.file_url ?? null,
    file?.is_encrypted,
    file?.user_id ?? null,
    file?.file_name ?? '',
    layer.fileId,
  )
  const kind = classifyFileKind({ name: file?.file_name, mime_type: file?.mime_type })
  const style: CSSProperties = {
    objectFit: layer.objectFit,
    transform: `translate(${layer.panX * 100}%, ${layer.panY * 100}%) scale(${layer.zoom})`,
    transformOrigin: 'center center',
  }

  if (loading || (!displayUrl && !failed)) return <div className="editor-slot__skeleton" aria-hidden />
  if (failed || !displayUrl) return <span>Preview unavailable</span>
  if (kind === 'video' || file?.mime_type?.startsWith('video/')) {
    return (
      <video
        ref={videoRef}
        src={displayUrl}
        muted={layer.muted || !audioMaster}
        playsInline
        preload="metadata"
        style={style}
        onLoadedMetadata={(e) => {
          onDuration(e.currentTarget.duration || 0)
          e.currentTarget.playbackRate = layer.speed || 1
          e.currentTarget.volume = layer.volume ?? 1
          if (layer.trimStart > 0) e.currentTarget.currentTime = layer.trimStart
        }}
        onTimeUpdate={(e) => {
          onTime(e.currentTarget.currentTime)
          const end = layer.trimEnd
          if (end != null && e.currentTarget.currentTime >= end) {
            e.currentTarget.pause()
            e.currentTarget.currentTime = layer.trimStart
          }
        }}
      />
    )
  }
  return <img src={displayUrl} alt="" style={style} />
}
