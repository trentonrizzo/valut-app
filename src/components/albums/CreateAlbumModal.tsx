import { useState, type FormEvent } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}

export function CreateAlbumModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onCreate(trimmed)
      setName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create album.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-album-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="create-album-title" className="modal__title">
          New album
        </h2>
        <form onSubmit={handleSubmit} className="modal__form">
          <label htmlFor="album-name" className="field-label">
            Name
          </label>
          <input
            id="album-name"
            type="text"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer 2025"
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
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
