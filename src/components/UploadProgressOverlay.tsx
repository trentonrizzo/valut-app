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
        <p id="upload-progress-title" className="vault-upload-chip__meta">
          {uploadBatchTotal > 0 ? (
            <span className="vault-upload-chip__batch">
              {uploadBatchIndex} of {uploadBatchTotal}
            </span>
          ) : null}
          {uploadBatchTotal > 0 ? <span className="vault-upload-chip__sep"> · </span> : null}
          <span>{uploadProgress}%</span>
        </p>
        <p className="vault-upload-chip__name" title={uploadFileName ?? undefined}>
          {uploadFileName ?? 'File'}
        </p>
        {uploadEtaText ? <p className="vault-upload-chip__eta">{uploadEtaText}</p> : null}
        <div className="vault-upload-chip__bar" aria-label="Upload progress">
          <div className="vault-upload-chip__bar-fill" style={{ width: `${uploadProgress}%` }} />
        </div>
      </div>
    </div>
  )
}
