export type UploadQueueItem = {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'failed' | 'done'
}

type Props = {
  visible: boolean
  items: UploadQueueItem[]
  overallProgress: number
  etaText: string | null
  currentFileIndex: number
  batchTotal: number
  currentFileName: string | null
  onRetry?: (id: string) => void
  onDismiss?: () => void
}

export function UploadQueueOverlay({
  visible,
  items,
  overallProgress,
  etaText,
  currentFileIndex,
  batchTotal,
  currentFileName,
  onRetry,
  onDismiss,
}: Props) {
  if (!visible) return null

  const hasFailed = items.some((i) => i.status === 'failed')

  return (
    <div className="modal-backdrop vault-upload-overlay" role="presentation">
      <div
        className="vault-upload-chip vault-upload-chip--queue modal--enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-queue-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p id="upload-queue-title" className="vault-upload-chip__status">
          {batchTotal > 0 ? (
            <>
              Uploading {currentFileIndex} of {batchTotal}…
            </>
          ) : (
            'Uploading…'
          )}
        </p>
        <p className="vault-upload-chip__meta">
          <span>{overallProgress}%</span>
          {etaText ? (
            <>
              <span className="vault-upload-chip__sep"> · </span>
              <span className="vault-upload-chip__eta-inline">{etaText}</span>
            </>
          ) : null}
        </p>
        {currentFileName ? (
          <p className="vault-upload-chip__name" title={currentFileName}>
            {currentFileName}
          </p>
        ) : null}
        <div className="vault-upload-chip__bar" aria-label="Overall upload progress">
          <div className="vault-upload-chip__bar-fill" style={{ width: `${overallProgress}%` }} />
        </div>

        {items.length > 0 ? (
          <ul className="vault-upload-queue" aria-label="Per-file progress">
            {items.map((item) => (
              <li key={item.id} className="vault-upload-queue__row">
                <div className="vault-upload-queue__head">
                  <span className="vault-upload-queue__name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="vault-upload-queue__pct">
                    {item.status === 'failed' ? (
                      <span className="vault-upload-queue__failed">Failed</span>
                    ) : (
                      `${item.progress}%`
                    )}
                  </span>
                </div>
                <div className="vault-upload-queue__bar">
                  <div
                    className="vault-upload-queue__bar-fill"
                    style={{
                      width: `${item.status === 'failed' ? 0 : item.progress}%`,
                    }}
                  />
                </div>
                {item.status === 'failed' && onRetry ? (
                  <button type="button" className="vault-upload-queue__retry btn btn--ghost" onClick={() => onRetry(item.id)}>
                    Retry
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {hasFailed && onDismiss ? (
          <button type="button" className="vault-upload-queue__dismiss btn btn--ghost" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}
