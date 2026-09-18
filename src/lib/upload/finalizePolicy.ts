import type { UploadStage } from './strategy'

export type RetryScope = 'bytes' | 'complete' | 'catalog' | 'needs-file' | 'done'

export type RetryJob = {
  state?: UploadStage
  r2Complete?: boolean
  multipartComplete?: boolean
  dbComplete?: boolean
  uploadId?: string | null
  parts?: { done: boolean; etag?: string | null }[]
}

export function nextRetryScope(job: RetryJob, hasFile: boolean): RetryScope {
  if (job.dbComplete || job.state === 'complete') return 'done'
  if (job.r2Complete || job.multipartComplete) return 'catalog'
  const parts = job.parts ?? []
  const allPartsDone = parts.length > 0 && parts.every((p) => p.done && p.etag)
  if (allPartsDone && job.uploadId) return 'complete'
  if (allPartsDone && !job.uploadId) return 'catalog'
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
  if (scope === 'catalog' || scope === 'complete') {
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
