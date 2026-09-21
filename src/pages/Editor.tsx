import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
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
} from '../lib/editor/projects'
import { useDecryptedMediaSrc } from '../hooks/useDecryptedMediaSrc'

export function Editor() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [projects, setProjects] = useState<EditorProject[]>([])
  const [title, setTitle] = useState('Untitled')
  const [payload, setPayload] = useState<EditorProjectPayload>(emptyPayload('2x2'))
  const [projectId, setProjectId] = useState<string | undefined>()
  const [picker, setPicker] = useState<FileRow[]>([])
  const [slotIndex, setSlotIndex] = useState<number | null>(null)
  const exportCaps = useMemo(() => exportSupported(), [])

  useEffect(() => {
    if (!user) return
    void listEditorProjects(user.id).then(setProjects).catch((e) => showToast(e instanceof Error ? e.message : 'Could not load projects', 'error'))
    void listMediaPage({ userId: user.id, filters: DEFAULT_MEDIA_FILTERS, limit: 60 })
      .then((p) => setPicker(p.rows))
      .catch(() => {})
  }, [user, showToast])

  function setLayout(layout: EditorProjectPayload['layout']) {
    const next = emptyPayload(layout)
    next.slots = next.slots.map((s, i) => payload.slots[i] ?? s)
    setPayload(next)
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

  return (
    <div className="dashboard editor-page">
      <main className="dashboard__main">
        <div className="dashboard__toolbar">
          <div>
            <h1 className="dashboard__title">Editor</h1>
            <p className="dashboard__subtitle">Non-destructive collage / trim projects. Originals stay untouched.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Save project
          </button>
        </div>
        <div className="filter-bar">
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Project title" />
          {(['1', '1x2', '2x1', '1+2', '2x2'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`btn btn--ghost ${payload.layout === l ? 'is-on' : ''}`}
              onClick={() => setLayout(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className={`editor-canvas editor-canvas--${payload.layout === '1+2' ? 'plus' : payload.layout}`}>
          {payload.slots.map((slot, i) => (
            <button
              key={i}
              type="button"
              className={`editor-slot ${slotIndex === i ? 'is-on' : ''}`}
              onClick={() => setSlotIndex(i)}
            >
              {slot.fileId ? (
                <EditorSlotPreview fileId={slot.fileId} files={picker} />
              ) : (
                <span>Tap to choose media</span>
              )}
            </button>
          ))}
        </div>
        {slotIndex != null ? (
          <div className="editor-tools">
            <p className="dashboard__subtitle">Slot {slotIndex + 1}</p>
            <div className="editor-picker">
              {picker.map((f) => {
                const kind = classifyFileKind({ name: f.file_name, mime_type: f.mime_type })
                if (kind !== 'image' && kind !== 'video') return null
                return (
                  <button
                    key={f.id}
                    type="button"
                    className="btn btn--outline"
                    onClick={() => {
                      const slots = payload.slots.slice()
                      slots[slotIndex] = {
                        ...slots[slotIndex]!,
                        fileId: f.id,
                        kind,
                        muted: kind === 'video' ? slotIndex !== payload.audioMasterIndex : true,
                      }
                      setPayload({ ...payload, slots })
                    }}
                  >
                    {f.file_name}
                  </button>
                )
              })}
            </div>
            {payload.slots[slotIndex]?.kind === 'video' ? (
              <div className="filter-bar">
                <label className="filter-bar__num">
                  Trim start (s)
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    value={payload.slots[slotIndex]!.trimStart}
                    onChange={(e) => {
                      const slots = payload.slots.slice()
                      slots[slotIndex] = { ...slots[slotIndex]!, trimStart: Number(e.target.value) || 0 }
                      setPayload({ ...payload, slots })
                    }}
                  />
                </label>
                <label className="filter-bar__num">
                  <input
                    type="checkbox"
                    checked={!payload.slots[slotIndex]!.muted}
                    onChange={(e) => {
                      const slots = payload.slots.slice()
                      slots[slotIndex] = { ...slots[slotIndex]!, muted: !e.target.checked }
                      setPayload({ ...payload, slots })
                    }}
                  />
                  Audio on
                </label>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setPayload({ ...payload, audioMasterIndex: slotIndex })}
                >
                  Make audio master
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                const slots = payload.slots.slice()
                slots[slotIndex] = emptyPayload().slots[0]!
                setPayload({ ...payload, slots })
              }}
            >
              Clear slot
            </button>
          </div>
        ) : null}
        <p className="dashboard__subtitle">
          Export:{' '}
          {exportCaps.mediaRecorder
            ? 'This browser reports MediaRecorder. Export of a new Vault file is still limited on iPhone — save the project instead of forcing a 4K render.'
            : 'Export is unavailable on this device. The project stays editable and originals are safe.'}
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

function EditorSlotPreview({ fileId, files }: { fileId: string; files: FileRow[] }) {
  const file = files.find((f) => f.id === fileId)
  const { displayUrl } = useDecryptedMediaSrc(file?.file_url ?? null, file?.is_encrypted, file?.user_id ?? null, file?.file_name ?? '', fileId)
  if (!file || !displayUrl) return <span>{file?.file_name ?? 'Media'}</span>
  const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
  if (kind === 'video') return <video src={displayUrl} muted playsInline preload="metadata" />
  return <img src={displayUrl} alt="" />
}
