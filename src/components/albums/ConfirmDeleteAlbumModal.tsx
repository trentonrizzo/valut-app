type Props = {
  open: boolean
  albumName: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function ConfirmDeleteAlbumModal({ open, albumName, onClose, onConfirm }: Props) {
  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--enter modal--danger"
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
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void onConfirm()}
          >
            Delete album
          </button>
        </div>
      </div>
    </div>
  )
}
