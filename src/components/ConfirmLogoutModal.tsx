type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmLogoutModal({ open, onClose, onConfirm }: Props) {
  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--enter"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        aria-describedby="logout-modal-desc"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="logout-modal-title" className="modal__title">
          Log out?
        </h2>
        <p id="logout-modal-desc" className="modal__body-text">
          Are you sure you want to log out?
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
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
