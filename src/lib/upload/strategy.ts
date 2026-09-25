/** Upload strategy, identity matching, and progress display. No I/O. */

export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024
export const DEFAULT_PART_BYTES = 8 * 1024 * 1024
export const MIN_S3_PART_BYTES = 5 * 1024 * 1024
export const MAX_PARTS = 10_000
export const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024
export const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024
export const MAX_QUEUE_ITEMS = Number.POSITIVE_INFINITY

export type UploadStage =
  | 'queued'
  | 'preparing'
  | 'encrypting'
  | 'uploading'
  | 'finalizing'
  | 'complete'
  | 'paused'
  | 'retrying'
  | 'failed'
  | 'needs-file'

export type PlannedPart = {
  partNumber: number
  bytes: number
}

export type UploadPlan = {
  useMultipart: boolean
  partSize: number
  parts: PlannedPart[]
}

export function providerLimitError(fileSize: number): string | null {
  if (fileSize > MAX_OBJECT_BYTES) {
    return `File is larger than the R2 object limit (${MAX_OBJECT_BYTES} bytes).`
  }
  return null
}

export function planUpload(fileSize: number, threshold = MULTIPART_THRESHOLD_BYTES): UploadPlan {
  const size = Math.max(0, Math.floor(fileSize))
  const limit = providerLimitError(size)
  if (limit) throw codedError('ERR_PROVIDER_LIMIT', limit)
  if (size <= threshold) {
    return {
      useMultipart: false,
      partSize: size || threshold,
      parts: [{ partNumber: 1, bytes: size }],
    }
  }

  let partSize = DEFAULT_PART_BYTES
  let count = Math.ceil(size / partSize)
  while (count > MAX_PARTS) {
    partSize *= 2
    if (partSize > MAX_PART_BYTES) {
      throw codedError('ERR_PROVIDER_LIMIT', 'File requires more than 10,000 R2 parts even at the maximum part size.')
    }
    count = Math.ceil(size / partSize)
  }

  const parts: PlannedPart[] = []
  let remaining = size
  let n = 1
  while (remaining > 0) {
    const bytes = Math.min(partSize, remaining)
    parts.push({ partNumber: n, bytes })
    remaining -= bytes
    n += 1
  }
  return { useMultipart: true, partSize, parts }
}

export function shouldUseMultipart(fileSize: number): boolean {
  return planUpload(fileSize).useMultipart
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  hevc: 'video/mp4',
  h265: 'video/mp4',
}

export function stripMimeParams(raw: string): string {
  return String(raw || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function normalizeUploadMime(file: { name: string; type?: string }): string {
  const raw = stripMimeParams(file.type || '')
  if (raw && raw !== 'application/octet-stream' && raw !== 'binary/octet-stream') return raw
  return MIME_BY_EXT[extOf(file.name)] || raw || 'application/octet-stream'
}

export function isVideoUpload(file: { name: string; type?: string }): boolean {
  const mime = normalizeUploadMime(file)
  const ext = extOf(file.name)
  return (
    mime.startsWith('video/') ||
    mime === 'application/mxf' ||
    /^(mp4|m4v|mov|qt|webm|mkv|ogv|ogg|hevc|h265)$/.test(ext)
  )
}

export function isImageUpload(file: { name: string; type?: string }): boolean {
  const mime = normalizeUploadMime(file)
  return mime.startsWith('image/')
}

export function normalizeFileName(name: string): string {
  return String(name || '').trim().toLowerCase()
}

export function fileMatchesResume(
  file: { name: string; size: number; lastModified?: number },
  job: { fileName: string; size: number; lastModified?: number | null },
): { ok: true } | { ok: false; reason: string } {
  if (file.size !== job.size) {
    return { ok: false, reason: 'Selected file size does not match the paused upload.' }
  }
  if (normalizeFileName(file.name) !== normalizeFileName(job.fileName)) {
    return { ok: false, reason: 'Selected file name does not match the paused upload.' }
  }
  if (
    job.lastModified != null &&
    file.lastModified != null &&
    job.lastModified > 0 &&
    file.lastModified > 0 &&
    job.lastModified !== file.lastModified
  ) {
    return { ok: false, reason: 'Selected file last-modified time does not match the paused upload.' }
  }
  return { ok: true }
}

export function canFinalizeWithoutFile(job: {
  r2Complete?: boolean
  r2Verified?: boolean
  multipartComplete?: boolean
  parts?: { done: boolean; etag?: string | null }[]
}): boolean {
  if (job.r2Verified || job.r2Complete || job.multipartComplete) return true
  const parts = job.parts ?? []
  return parts.length > 0 && parts.every((p) => p.done && Boolean(p.etag))
}

export function canCatalogReady(job: {
  r2Verified?: boolean
  verifiedSize?: number | null
  size: number
  storedSize?: number | null
  encryptionVersion?: number
  chunkSize?: number | null
}): boolean {
  const expected =
    job.storedSize != null && Number.isFinite(job.storedSize)
      ? job.storedSize
      : (job.encryptionVersion ?? 0) > 0
        ? job.storedSize
        : job.size
  if ((job.encryptionVersion ?? 0) > 0 && (job.storedSize == null || !Number.isFinite(job.storedSize))) {
    return false
  }
  return Boolean(job.r2Verified && job.verifiedSize === expected)
}

export function classifyUploadError(e: unknown, stage: string): UploadCodedError {
  if (e instanceof UploadCodedError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (/paused|cancelled/i.test(msg)) return codedError('ERR_PAUSED', msg)
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(msg)) {
    return codedError('ERR_NETWORK', `${stage}: browser network request failed`)
  }
  if (/etag/i.test(msg)) return codedError('ERR_ETAG', `${stage}: ${msg}`)
  return codedError('ERR_UPLOAD', `${stage}: ${msg}`)
}

export function displayProgress(job: {
  state: UploadStage
  size: number
  uploadedBytes: number
}): { percent: number; label: string; showEta: boolean; complete: boolean } {
  const bytePct = job.size > 0 ? Math.round((Math.min(job.uploadedBytes, job.size) / job.size) * 100) : 0
  switch (job.state) {
    case 'complete':
      return { percent: 100, label: 'Complete', showEta: false, complete: true }
    case 'finalizing':
      return { percent: Math.min(99, bytePct), label: 'Verifying…', showEta: false, complete: false }
    case 'preparing':
      return { percent: 0, label: 'Preparing', showEta: false, complete: false }
    case 'encrypting':
      return { percent: Math.min(99, bytePct), label: 'Preparing', showEta: false, complete: false }
    case 'uploading':
      return { percent: Math.min(99, bytePct), label: 'Uploading', showEta: true, complete: false }
    case 'retrying':
      return { percent: Math.min(99, bytePct), label: 'Retrying', showEta: true, complete: false }
    case 'paused':
      return { percent: Math.min(99, bytePct), label: 'Paused', showEta: false, complete: false }
    case 'queued':
      return { percent: 0, label: 'Queued', showEta: false, complete: false }
    case 'needs-file':
      return { percent: Math.min(99, bytePct), label: 'Reselect to resume', showEta: false, complete: false }
    case 'failed':
      return { percent: Math.min(99, bytePct), label: 'Failed', showEta: false, complete: false }
    default:
      return { percent: Math.min(99, bytePct), label: 'Uploading', showEta: true, complete: false }
  }
}

export function formatSpeedBps(bps: number): string | null {
  if (!Number.isFinite(bps) || bps < 250) return null
  const mb = bps / (1024 * 1024)
  if (mb >= 0.1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB/s`
  const kb = bps / 1024
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB/s`
}

export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
  // Bucket short ETAs so the UI does not thrash between ~2s and ~30s.
  if (seconds < 60) {
    const bucket = Math.max(5, Math.round(seconds / 5) * 5)
    return `~${bucket}s left`
  }
  return `~${Math.round(seconds / 60)}m left`
}

export function uniqueOriginalKey(userId: string, objectId: string): string {
  return `users/${userId}/originals/${objectId}`
}

export class UploadCodedError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UploadCodedError'
    this.code = code
  }
}

export function codedError(code: string, message: string): UploadCodedError {
  return new UploadCodedError(code, message)
}

export function errorCodeOf(e: unknown): string {
  if (e instanceof UploadCodedError) return e.code
  if (e instanceof Error && /paused|cancelled/i.test(e.message)) return 'ERR_PAUSED'
  return 'ERR_UPLOAD'
}
