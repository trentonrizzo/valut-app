import { useEffect, useState } from 'react'

type Props = {
  open: boolean
  albumName: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function ConfirmDeleteAlbumModal({ open, albumName, onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  if (!open) return null

  async function handleDelete() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop modal-backdrop--mobile-safe"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="modal modal--enter modal--mobile-safe modal--danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-album-title"
        aria-describedby="delete-album-desc"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="delete-album-title" className="modal__title">
          Delete album?
        </h2>
        <p id="delete-album-desc" className="modal__body-text">
          <strong className="modal__album-name">{albumName}</strong> will be permanently deleted.
          Items inside this album will be removed. This can’t be undone.
        </p>
        <div className="modal__actions modal__actions--split">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            {busy ? 'Deleting…' : 'Delete album'}
          </button>
        </div>
      </div>
    </div>
  )
}
