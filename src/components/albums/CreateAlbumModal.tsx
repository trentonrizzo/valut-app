import { useEffect, useState, type FormEvent } from 'react'

type ParentOption = { id: string; name: string }

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (name: string, parentAlbumId: string | null) => Promise<void>
  /** Optional parent when creating inside a collection. */
  defaultParentId?: string | null
  parentOptions?: ParentOption[]
}

export function CreateAlbumModal({
  open,
  onClose,
  onCreate,
  defaultParentId = null,
  parentOptions = [],
}: Props) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string | null>(defaultParentId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setParentId(defaultParentId)
      setError(null)
      setSubmitting(false)
    }
  }, [open, defaultParentId])

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
      await onCreate(trimmed, parentId)
      setName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create album.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!submitting) onClose()
      }}
    >
      <div
        className="modal modal--enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-album-title"
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
        <h2 id="create-album-title" className="modal__title">
          New collection
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
          {parentOptions.length > 0 ? (
            <>
              <label htmlFor="album-parent" className="field-label">
                Inside collection
              </label>
              <select
                id="album-parent"
                className="vault-sort-select"
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
                disabled={submitting}
              >
                <option value="">Root (top level)</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
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
