import { formatBytes } from '../formatBytes'
import { displayProgress, formatEta, formatSpeedBps, type UploadStage } from './strategy'
import type { UploadQueueItem } from '../../components/UploadQueueOverlay'

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

export function liveToQueueItem(j: LiveLike): UploadQueueItem {
  const ui = displayProgress(j)
  return {
    id: j.id,
    name: j.fileName,
    size: j.size,
    type: j.type,
    progress: ui.percent,
    status: overlayStatus(j.state),
    error: j.error,
    speedText: ui.showEta ? formatSpeedBps(j.speedBps) : null,
    etaText: ui.showEta ? formatEta(j.etaSeconds) : null,
    stateLabel: ui.label,
    uploadedBytes: j.uploadedBytes,
    needsFile: j.state === 'needs-file',
    canPause: j.state === 'uploading' || j.state === 'preparing' || j.state === 'encrypting' || j.state === 'finalizing',
    canResume: j.state === 'paused',
    canRetry: j.state === 'failed' || j.state === 'needs-file',
    bytesText: `${formatBytes(Math.min(j.uploadedBytes, j.size))} / ${formatBytes(j.size)}`,
  }
}

export function liveToQueueItems(items: LiveLike[]): UploadQueueItem[] {
  return items.map(liveToQueueItem)
}
