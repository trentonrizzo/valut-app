export type UploadQueueStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'finalizing'
  | 'retrying'
  | 'done'
  | 'failed'

export type UploadQueueItem = {
  id: string
  name: string
  size: number
  type: string
  progress: number
  status: UploadQueueStatus
  error: string | null
  speedText?: string | null
  etaText?: string | null
  stateLabel?: string | null
  uploadedBytes?: number
  needsFile?: boolean
  canPause?: boolean
  canResume?: boolean
  canRetry?: boolean
  bytesText?: string | null
}

type Props = {
  visible: boolean
  items: UploadQueueItem[]
  overallProgress: number
  etaText: string | null
  currentFileIndex: number
  batchTotal: number
  currentFileName: string | null
  currentFilePercent: number | null
  onRetry?: (id: string) => void
  onRetryAll?: () => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
  onCancel?: (id: string) => void
  onReselect?: (id: string, file: File) => void
  onDismiss?: () => void
}

function statusLabel(item: UploadQueueItem): string {
  if (item.stateLabel) return item.stateLabel
  switch (item.status) {
    case 'queued':
      return 'Queued'
    case 'preparing':
      return 'Preparing'
    case 'uploading':
      return 'Uploading'
    case 'finalizing':
      return 'Finalizing…'
    case 'retrying':
      return 'Retrying'
    case 'done':
      return 'Complete'
    case 'failed':
      return 'Failed'
    default:
      return ''
  }
}

export function UploadQueueOverlay({
  visible,
  items,
  overallProgress,
  etaText,
  currentFileIndex,
  batchTotal,
  currentFileName,
  currentFilePercent,
  onRetry,
  onRetryAll,
  onPause,
  onResume,
  onCancel,
  onReselect,
  onDismiss,
}: Props) {
  if (!visible) return null

  const hasFailed = items.some((i) => i.status === 'failed')
  const failedCount = items.filter((i) => i.status === 'failed').length
  const doneCount = items.filter((i) => i.status === 'done').length
  const active = items.some((i) =>
    ['queued', 'preparing', 'uploading', 'finalizing', 'retrying'].includes(i.status),
  )
  const title =
    failedCount > 0 && !active
      ? `${failedCount} failed`
      : doneCount === batchTotal && batchTotal > 0
        ? 'Upload complete'
        : batchTotal > 0
          ? `${Math.min(batchTotal, currentFileIndex)} of ${batchTotal}`
          : 'Uploading…'

  return (
    <div className="modal-backdrop vault-upload-overlay" role="presentation">
      <div
        className="vault-upload-chip vault-upload-chip--queue modal--enter"
        role="dialog"
        aria-modal="false"
        aria-labelledby="upload-queue-title"
        aria-busy={active}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p id="upload-queue-title" className="vault-upload-chip__status">
          {title}
        </p>
        <p className="vault-upload-chip__meta">
          <span>
            {doneCount}/{batchTotal || items.length} complete
            {failedCount ? ` · ${failedCount} failed` : ''}
          </span>
          {active ? (
            <>
              <span className="vault-upload-chip__sep"> · </span>
              <span>{overallProgress}%</span>
            </>
          ) : null}
          {etaText && active ? (
            <>
              <span className="vault-upload-chip__sep"> · </span>
              <span className="vault-upload-chip__eta-inline">{etaText}</span>
            </>
          ) : null}
        </p>
        {currentFileName && active ? (
          <p className="vault-upload-chip__name" title={currentFileName}>
            {currentFileName}
            {currentFilePercent != null && currentFilePercent >= 0 ? (
              <span className="vault-upload-chip__current-pct"> · {currentFilePercent}%</span>
            ) : null}
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
                    {item.status === 'done' ? (
                      <span className="vault-upload-queue__ok">Complete ✓</span>
                    ) : item.status === 'failed' ? (
                      <span className="vault-upload-queue__failed">Failed</span>
                    ) : item.status === 'finalizing' ? (
                      <span className="vault-upload-queue__phase">Finalizing…</span>
                    ) : item.status === 'queued' || item.status === 'preparing' || item.status === 'retrying' ? (
                      <span className="vault-upload-queue__phase">{statusLabel(item)}</span>
                    ) : (
                      `${item.progress}%`
                    )}
                  </span>
                </div>
                <div className="vault-upload-queue__bar">
                  <div
                    className="vault-upload-queue__bar-fill"
                    style={{
                      width: `${
                        item.status === 'done' ? 100 : item.status === 'queued' ? 0 : item.progress
                      }%`,
                    }}
                  />
                </div>
                <p className="vault-upload-queue__bytes">{item.bytesText}</p>
                {item.error ? (
                  <p className="vault-upload-queue__err" role="alert">
                    {item.error}
                  </p>
                ) : item.status === 'finalizing' ? (
                  <p className="vault-upload-queue__hint">Finalizing…</p>
                ) : item.speedText || item.stateLabel ? (
                  <p className="vault-upload-queue__hint">
                    {item.stateLabel}
                    {item.speedText ? ` · ${item.speedText}` : ''}
                    {item.etaText ? ` · ${item.etaText}` : ''}
                  </p>
                ) : null}
                <div className="vault-upload-queue__actions">
                  {item.canPause && onPause ? (
                    <button type="button" className="vault-upload-queue__btn btn btn--ghost" onClick={() => onPause(item.id)}>
                      Pause
                    </button>
                  ) : null}
                  {item.canResume && onResume ? (
                    <button type="button" className="vault-upload-queue__btn btn btn--ghost" onClick={() => onResume(item.id)}>
                      Resume
                    </button>
                  ) : null}
                  {item.canRetry && onRetry ? (
                    <button type="button" className="vault-upload-queue__btn btn btn--ghost" onClick={() => onRetry(item.id)}>
                      Retry
                    </button>
                  ) : null}
                  {item.needsFile && onReselect ? (
                    <label className="vault-upload-queue__btn btn btn--ghost">
                      Reselect
                      <input
                        type="file"
                        className="visually-hidden"
                        onChange={(e) => {
                          const f = e.currentTarget.files?.[0]
                          e.currentTarget.value = ''
                          if (f) onReselect(item.id, f)
                        }}
                      />
                    </label>
                  ) : null}
                  {onCancel && item.status !== 'done' ? (
                    <button type="button" className="vault-upload-queue__btn btn btn--ghost" onClick={() => onCancel(item.id)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="vault-upload-queue__footer">
          {hasFailed && onRetryAll ? (
            <button type="button" className="vault-upload-queue__dismiss btn btn--ghost" onClick={onRetryAll}>
              Retry failed
            </button>
          ) : null}
          {hasFailed && onDismiss ? (
            <button type="button" className="vault-upload-queue__dismiss btn btn--ghost" onClick={onDismiss}>
              Dismiss failed
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
