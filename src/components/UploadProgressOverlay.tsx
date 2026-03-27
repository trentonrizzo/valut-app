type Props = {
  uploading: boolean
  uploadProgress: number
  uploadFileName: string | null
  uploadBatchIndex: number
  uploadBatchTotal: number
  uploadEtaText: string | null
}

export function UploadProgressOverlay({
  uploading,
  uploadProgress,
  uploadFileName,
  uploadBatchIndex,
  uploadBatchTotal,
  uploadEtaText,
}: Props) {
  if (!uploading) return null

  return (
    <div className="modal-backdrop vault-upload-overlay" role="presentation">
      <div
        className="vault-upload-chip modal--enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-progress-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p id="upload-progress-title" className="vault-upload-chip__status">
          {uploadBatchTotal > 0 ? (
            <>
              Uploading {uploadBatchIndex} of {uploadBatchTotal}…
            </>
          ) : (
            'Uploading…'
          )}
        </p>
        <p className="vault-upload-chip__meta">
          <span>{uploadProgress}%</span>
          {uploadEtaText ? (
            <>
              <span className="vault-upload-chip__sep"> · </span>
              <span className="vault-upload-chip__eta-inline">{uploadEtaText}</span>
            </>
          ) : null}
        </p>
        <p className="vault-upload-chip__name" title={uploadFileName ?? undefined}>
          {uploadFileName ?? 'File'}
        </p>
        <div className="vault-upload-chip__bar" aria-label="Upload progress">
          <div className="vault-upload-chip__bar-fill" style={{ width: `${uploadProgress}%` }} />
        </div>
      </div>
    </div>
  )
}
