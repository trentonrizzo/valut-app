import { canCatalogReady, type UploadStage } from './strategy'

export type RetryScope = 'bytes' | 'complete' | 'verify' | 'catalog' | 'album' | 'needs-file' | 'done'

export type RetryJob = {
  state?: UploadStage
  r2Complete?: boolean
  r2Verified?: boolean
  multipartComplete?: boolean
  dbComplete?: boolean
  albumComplete?: boolean
  verifiedSize?: number | null
  size?: number
  storedSize?: number | null
  encryptionVersion?: number
  chunkSize?: number | null
  uploadId?: string | null
  parts?: { done: boolean; etag?: string | null }[]
}

export function nextRetryScope(job: RetryJob, hasFile: boolean): RetryScope {
  if (job.dbComplete || job.state === 'complete') return 'done'
  if (job.r2Verified && canCatalogReady({ ...job, size: job.size ?? 0 }) && !job.dbComplete) {
    return job.albumComplete === false ? 'album' : 'catalog'
  }
  if (job.r2Complete || job.multipartComplete) return 'verify'
  const parts = job.parts ?? []
  const allPartsDone = parts.length > 0 && parts.every((p) => p.done && p.etag)
  if (allPartsDone && job.uploadId) return 'complete'
  if (allPartsDone && !job.uploadId) return 'verify'
  if (!hasFile) return 'needs-file'
  return 'bytes'
}

export function reconcilePersistedJob(
  job: RetryJob & { error?: string | null },
  hasFile: boolean,
): { state: UploadStage; error: string | null; autoRetry: boolean } {
  if (job.dbComplete || job.state === 'complete') {
    return { state: 'complete', error: null, autoRetry: false }
  }
  const scope = nextRetryScope(job, hasFile)
  if (scope === 'catalog' || scope === 'complete' || scope === 'verify' || scope === 'album') {
    return { state: 'queued', error: null, autoRetry: true }
  }
  if (scope === 'needs-file') {
    return {
      state: 'needs-file',
      error:
        'Reselect this file to resume missing bytes. Dismiss will not delete a stored original.',
      autoRetry: false,
    }
  }
  if (hasFile) {
    return { state: 'queued', error: null, autoRetry: true }
  }
  return { state: 'failed', error: job.error ?? 'Upload failed', autoRetry: false }
}

export function cancelDeletesOriginal(_job: { r2Complete?: boolean; multipartComplete?: boolean }): boolean {
  return false
}

export function missingPartNumbers(parts: { partNumber: number; done: boolean }[]): number[] {
  return parts.filter((p) => !p.done).map((p) => p.partNumber)
}

export function progressIsComplete(state: UploadStage): boolean {
  return state === 'complete'
}

export function shouldExposeInLibrary(row: { upload_status?: string | null }): boolean {
  return row.upload_status == null || row.upload_status === 'ready'
}

export function shouldSkipByteUpload(job: RetryJob): boolean {
  const scope = nextRetryScope(job, true)
  return scope === 'complete' || scope === 'verify' || scope === 'catalog' || scope === 'album' || scope === 'done'
}

export function catalogReadyAllowed(job: { r2Verified?: boolean; verifiedSize?: number | null; size: number }): boolean {
  return canCatalogReady(job)
}

export function duplicateSafeUpsert() {
  return { fileOnConflict: 'id', albumOnConflict: 'album_id,file_id' } as const
}
