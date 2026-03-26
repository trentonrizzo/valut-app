type Props = {
  open: boolean
  fileName: string
  onClose: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}

export function ConfirmDeleteFileModal({ open, fileName, onClose, onConfirm, deleting }: Props) {
  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={deleting ? undefined : onClose}>
      <div
        className="modal modal--enter modal--danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-file-title"
        aria-describedby="delete-file-desc"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="delete-file-title" className="modal__title">
          Delete file?
        </h2>
        <p id="delete-file-desc" className="modal__body-text">
          <strong className="modal__album-name">{fileName}</strong> will be permanently deleted.
        </p>
        <div className="modal__actions modal__actions--split">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void onConfirm()}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete file'}
          </button>
        </div>
      </div>
    </div>
  )
}
