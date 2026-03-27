import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  initialName: string
  onClose: () => void
  onRename: (name: string) => Promise<void>
}

export function RenameAlbumModal({ open, initialName, onClose, onRename }: Props) {
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setError(null)
      setSubmitting(false)
    }
  }, [open, initialName])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    if (trimmed === initialName.trim()) {
      onClose()
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onRename(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename album.')
    } finally {
      setSubmitting(false)
    }
  }

  const node = (
    <div
      className="modal-backdrop modal-backdrop--mobile-safe modal-backdrop--portal"
      role="presentation"
      onClick={() => {
        if (!submitting) onClose()
      }}
    >
      <div
        className="modal modal--enter modal--mobile-safe"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-album-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          type="button"
          className="modal__close"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
        >
          ×
        </button>
        <h2 id="rename-album-title" className="modal__title">
          Rename album
        </h2>
        <form onSubmit={handleSubmit} className="modal__form">
          <label htmlFor="rename-album-name" className="field-label">
            Name
          </label>
          <input
            id="rename-album-name"
            type="text"
            className="field-input field-input--modal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={submitting}
          />
          {error ? <p className="field-error">{error}</p> : null}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : null
}
