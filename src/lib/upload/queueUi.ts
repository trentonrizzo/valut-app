import { formatBytes } from '../formatBytes'
import { displayProgress, formatEta, formatSpeedBps, type UploadStage } from './strategy'
import type { UploadQueueItem } from '../../components/UploadQueueOverlay'
import { normalizeUploadMode, uploadModeLabel, type UploadMode } from './uploadMode'

type LiveLike = {
  id: string
  fileName: string
  size: number
  type: string
  uploadedBytes: number
  state: UploadStage
  error: string | null
  speedBps: number
  etaSeconds: number | null
  uploadMode?: UploadMode
}

function overlayStatus(state: UploadStage): UploadQueueItem['status'] {
  switch (state) {
    case 'complete':
      return 'done'
    case 'failed':
    case 'needs-file':
      return 'failed'
    case 'queued':
    case 'paused':
      return 'queued'
    case 'preparing':
    case 'encrypting':
      return 'preparing'
    case 'finalizing':
      return 'finalizing'
    case 'retrying':
      return 'retrying'
    case 'uploading':
    default:
      return 'uploading'
  }
}

export function humanUploadError(error: string | null, needsFile = false): string | null {
  if (needsFile) return 'Choose this file again to continue the upload.'
  if (!error) return null
  if (/network|load failed|failed to fetch|interrupted/i.test(error)) return 'Upload interrupted.'
  if (/empty|not readable|icloud/i.test(error)) return 'This file is not available on this device. Download it from iCloud, then choose it again.'
  const cleaned = error.replace(/^ERR_[A-Z_]+:\s*/i, '').replace(/^[a-z0-9_-]+:\s*/i, '')
  return cleaned || 'Upload failed.'
}

export function liveToQueueItem(j: LiveLike): UploadQueueItem {
  const ui = displayProgress(j)
  return {
    id: j.id,
    name: j.fileName,
    size: j.size,
    type: j.type,
    progress: ui.percent,
    status: overlayStatus(j.state),
    error: humanUploadError(j.error, j.state === 'needs-file'),
    speedText: ui.showEta ? formatSpeedBps(j.speedBps) : null,
    etaText: ui.showEta ? formatEta(j.etaSeconds) : null,
    stateLabel: ui.label,
    uploadedBytes: j.uploadedBytes,
    needsFile: j.state === 'needs-file',
    canPause: j.state === 'uploading' || j.state === 'preparing' || j.state === 'encrypting' || j.state === 'finalizing',
    canResume: j.state === 'paused',
    canRetry: j.state === 'failed',
    bytesText: `${formatBytes(Math.min(j.uploadedBytes, j.size))} / ${formatBytes(j.size)}`,
    modeLabel: uploadModeLabel(normalizeUploadMode(j.uploadMode)),
  }
}

export function liveToQueueItems(items: LiveLike[]): UploadQueueItem[] {
  return items.map(liveToQueueItem)
}
