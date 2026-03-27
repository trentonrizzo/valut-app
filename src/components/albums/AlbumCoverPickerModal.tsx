import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadCoverAndSetAlbum } from '../../lib/batchUploadToAlbum'
import { isVideoFileName } from '../../lib/mediaTypes'
import type { AlbumWithMeta } from '../../types/album'

type FileRow = {
  id: string
  file_name: string
  file_url: string
  created_at: string
  purpose: string | null
}

type Props = {
  open: boolean
  album: AlbumWithMeta | null
  userId: string
  onClose: () => void
  onSaved: () => void | Promise<void>
  onRemoved?: () => void | Promise<void>
}

type Panel = 'home' | 'pick'

export function AlbumCoverPickerModal({ open, album, userId, onClose, onSaved, onRemoved }: Props) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('home')

  const uploadInputRef = useRef<HTMLInputElement>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)
  const uploadStartMsRef = useRef(0)
  const uploadTotalBytesRef = useRef(0)

  useEffect(() => {
    if (!open || !album || !userId) return

    setError(null)
    setPanel('home')
    setSelectedId(null)
    setFiles([])
    setLoading(true)
    setLoadError(null)

    let cancelled = false
    ;(async () => {
      try {
        const { data, error: qErr } = await supabase
          .from('files')
          .select('id, file_name, file_url, created_at, purpose')
          .eq('album_id', album.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })

        if (qErr) throw new Error(qErr.message)
        if (cancelled) return
        const list = (data as FileRow[]) ?? []
        setFiles(list)
        setSelectedId(() => {
          const cov = album.cover_file_id
          if (cov && list.some((f) => f.id === cov)) return cov
          return list[0]?.id ?? null
        })
      } catch (e) {
        if (!cancelled) {
          setFiles([])
          setLoadError(e instanceof Error ? e.message : 'Could not load files')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, album?.id, album?.cover_file_id, userId])

  if (!open || !album || !userId) return null

  const al = album
  const hasCustomCover = al.cover_file_id != null

  async function handleSaveExisting() {
    if (!selectedId) {
      setError('Select a file.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { error: upErr } = await supabase
        .from('albums')
        .update({ cover_file_id: selectedId })
        .eq('id', al.id)
        .eq('user_id', userId)

      if (upErr) throw new Error(upErr.message)
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save cover')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveCover() {
    setError(null)
    setRemoving(true)
    try {
      const { error: upErr } = await supabase
        .from('albums')
        .update({ cover_file_id: null })
        .eq('id', al.id)
        .eq('user_id', userId)

      if (upErr) throw new Error(upErr.message)
      if (onRemoved) await onRemoved()
      else await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove cover')
    } finally {
      setRemoving(false)
    }
  }

  async function runCoverUpload(file: File | null) {
    if (!file) return
    setError(null)
    setUploading(true)
    setUploadPct(0)
    setUploadName(file.name)
    try {
      await uploadCoverAndSetAlbum(file, al.id, userId, {
        uploadStartMsRef,
        uploadTotalBytesRef,
      }, (p) => {
        setUploadPct(p.progress)
        setUploadName(p.fileName)
      })
      await onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadPct(0)
      setUploadName(null)
    }
  }

  const busy = saving || removing || uploading

  const modal = (
    <div
      className="modal-backdrop modal-backdrop--mobile-safe modal-backdrop--portal"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="modal modal--enter modal--mobile-safe modal--sheet album-cover-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-cover-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="album-cover-title" className="modal__title">
          Set album cover
        </h2>
        <p className="album-cover-picker__hint">
          Cover uploads are stored for this card only and do not add to album item count or storage
          totals.
        </p>

        <input
          ref={uploadInputRef}
          type="file"
          className="visually-hidden"
          accept="image/*,video/*"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void runCoverUpload(f ?? null)
          }}
        />
        <input
          ref={captureInputRef}
          type="file"
          className="visually-hidden"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void runCoverUpload(f ?? null)
          }}
        />

        {panel === 'home' ? (
          <div className="album-cover-picker__actions-grid">
            <button
              type="button"
              className="btn btn--outline album-cover-picker__action-btn"
              disabled={busy}
              onClick={() => {
                setError(null)
                setPanel('pick')
              }}
            >
              Choose existing
            </button>
            <button
              type="button"
              className="btn btn--outline album-cover-picker__action-btn"
              disabled={busy}
              onClick={() => uploadInputRef.current?.click()}
            >
              Upload photo/video
            </button>
            <button
              type="button"
              className="btn btn--outline album-cover-picker__action-btn"
              disabled={busy}
              onClick={() => captureInputRef.current?.click()}
            >
              Take photo
            </button>
            {hasCustomCover ? (
              <button
                type="button"
                className="btn btn--ghost album-cover-picker__action-btn album-cover-picker__action-btn--danger"
                disabled={busy}
                onClick={() => void handleRemoveCover()}
              >
                {removing ? 'Removing…' : 'Remove custom cover'}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="album-cover-picker__toolbar">
              <button
                type="button"
                className="btn btn--ghost album-cover-picker__back"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setPanel('home')
                }}
              >
                ← Back
              </button>
            </div>
            {loading ? (
              <p className="album-cover-picker__status">Loading files…</p>
            ) : loadError ? (
              <p className="field-error" role="alert">
                {loadError}
              </p>
            ) : files.length === 0 ? (
              <p className="album-cover-picker__status">
                No files in this album yet. Use Upload or Take photo on the previous screen.
              </p>
            ) : (
              <ul className="album-cover-picker__list" role="listbox" aria-label="Album files">
                {files.map((f) => {
                  const isSelected = selectedId === f.id
                  const isVid = isVideoFileName(f.file_name)
                  const isCoverAsset = f.purpose === 'cover'
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={`album-cover-picker__row ${isSelected ? 'is-selected' : ''}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => setSelectedId(f.id)}
                      >
                        <span className="album-cover-picker__thumb">
                          {isVid ? (
                            <>
                              <video src={f.file_url} muted playsInline preload="metadata" />
                              <span className="album-cover-picker__thumb-badge" aria-hidden>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5v14l11-7L8 5z" />
                                </svg>
                              </span>
                            </>
                          ) : (
                            <img src={f.file_url} alt="" loading="lazy" />
                          )}
                        </span>
                        <span className="album-cover-picker__name">
                          {f.file_name}
                          {isCoverAsset ? (
                            <span className="album-cover-picker__purpose">Cover asset</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="modal__actions modal__actions--split album-cover-picker__actions">
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleSaveExisting()}
                disabled={busy || loading || files.length === 0 || !selectedId}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}

        {uploading ? (
          <div className="album-cover-picker__upload-overlay" aria-live="polite">
            <div className="album-cover-picker__upload-box">
              <p className="album-cover-picker__upload-label">Uploading…</p>
              {uploadName ? <p className="album-cover-picker__upload-name">{uploadName}</p> : null}
              <div className="album-cover-picker__progress" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        {panel === 'home' ? (
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
