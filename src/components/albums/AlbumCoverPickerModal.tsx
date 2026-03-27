import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isVideoFileName } from '../../lib/mediaTypes'
import type { AlbumWithMeta } from '../../types/album'

type FileRow = {
  id: string
  file_name: string
  file_url: string
  created_at: string
}

type Props = {
  open: boolean
  album: AlbumWithMeta | null
  userId: string
  onClose: () => void
  /** After setting a custom cover from the picker */
  onSaved: () => void | Promise<void>
  /** After removing custom cover from this modal; defaults to onSaved */
  onRemoved?: () => void | Promise<void>
}

export function AlbumCoverPickerModal({ open, album, userId, onClose, onSaved, onRemoved }: Props) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !album || !userId) return

    setFiles([])
    setLoadError(null)
    setError(null)
    setSelectedId(null)
    setLoading(true)

    let cancelled = false
    ;(async () => {
      try {
        const { data, error: qErr } = await supabase
          .from('files')
          .select('id, file_name, file_url, created_at')
          .eq('album_id', album.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })

        if (qErr) throw new Error(qErr.message)
        if (!cancelled) {
          const list = (data as FileRow[]) ?? []
          setFiles(list)
          setSelectedId(() => {
            const cov = album.cover_file_id
            if (cov && list.some((f) => f.id === cov)) return cov
            return list[0]?.id ?? null
          })
        }
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
  }, [open, album, userId])

  if (!open || !album || !userId) return null

  const hasCustomCover = album.cover_file_id != null

  async function handleSave() {
    if (!album) return
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
        .eq('id', album.id)
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
    if (!album) return
    setError(null)
    setRemoving(true)
    try {
      const { error: upErr } = await supabase
        .from('albums')
        .update({ cover_file_id: null })
        .eq('id', album.id)
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

  const busy = saving || removing

  return (
    <div
      className="modal-backdrop modal-backdrop--mobile-safe"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="modal modal--enter modal--mobile-safe modal--sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-cover-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="album-cover-title" className="modal__title">
          Set album cover
        </h2>
        <p className="album-cover-picker__hint">
          Choose a file to show on the album card. The newest upload is used if no custom cover is set.
        </p>

        {loading ? (
          <p className="album-cover-picker__status">Loading files…</p>
        ) : loadError ? (
          <p className="field-error" role="alert">
            {loadError}
          </p>
        ) : files.length === 0 ? (
          <p className="album-cover-picker__status">No files in this album yet.</p>
        ) : (
          <ul className="album-cover-picker__list" role="listbox" aria-label="Album files">
            {files.map((f) => {
              const isSelected = selectedId === f.id
              const isVid = isVideoFileName(f.file_name)
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
                    <span className="album-cover-picker__name">{f.file_name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="album-cover-picker__footer">
          {hasCustomCover ? (
            <button
              type="button"
              className="btn btn--ghost album-cover-picker__remove"
              onClick={() => void handleRemoveCover()}
              disabled={busy}
            >
              {removing ? 'Removing…' : 'Remove custom cover'}
            </button>
          ) : null}
          <div className="modal__actions modal__actions--split album-cover-picker__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleSave()}
              disabled={busy || loading || files.length === 0 || !selectedId}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
