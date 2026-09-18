import { supabase } from '../supabase'
import { originalKey, posterKey, thumbKey } from '../storageKeys'
import {
  CHUNK_PLAINTEXT_BYTES,
  ENCRYPTION_VERSION,
  chunkCountForSize,
  encryptChunk,
  generateDek,
  newFileNonce,
  readFileSlice,
  exportRawKey,
} from '../crypto/chunkCipher'
import { wrapDek, bytesToBase64 } from '../crypto/envelope'
import { createAuthFetch, apiPutUrl, apiMultipartInit, apiMultipartPartUrl, apiMultipartComplete, apiMultipartAbort, apiRecordOrphan } from './storageApi'
import { deleteJob, listJobs, saveJob, type PersistedUploadJob, type UploadUiState } from './queueStore'
import {
  MAX_PARTS,
  MULTIPART_THRESHOLD_BYTES,
  fileConcurrency,
  partConcurrency,
  putWithRetry,
} from './multipartConfig'
import { extractMediaMetadata, makeImageThumbnail, makeVideoPoster } from './extractMetadata'

export type LiveUploadItem = PersistedUploadJob & {
  speedBps: number
  etaSeconds: number | null
  percent: number
}

type Listener = () => void

const filesInMemory = new Map<string, File>()
const abortByJob = new Map<string, AbortController>()
const paused = new Set<string>()
const listeners = new Set<Listener>()
const live = new Map<string, LiveUploadItem>()
const speedEma = new Map<string, number>()

let masterKey: CryptoKey | null = null
let accessToken = ''
let userId = ''
let pumping = false

function emit() {
  for (const l of listeners) l()
}

export function subscribeUploads(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getLiveUploads(): LiveUploadItem[] {
  return [...live.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function configureUploader(opts: { accessToken: string; userId: string; masterKey: CryptoKey | null }) {
  accessToken = opts.accessToken
  userId = opts.userId
  masterKey = opts.masterKey
}

export async function hydrateUploadQueue(): Promise<void> {
  const jobs = await listJobs()
  for (const j of jobs) {
    if (j.state === 'complete') {
      await deleteJob(j.id)
      continue
    }
    const needsFile = !filesInMemory.has(j.id)
    live.set(
      j.id,
      toLive({
        ...j,
        state: needsFile ? 'needs-file' : j.state,
        error: needsFile
          ? 'Reselect this file to resume. The browser cannot restore the original File after reload.'
          : j.error,
      }),
    )
  }
  emit()
}

function toLive(job: PersistedUploadJob, extra?: Partial<LiveUploadItem>): LiveUploadItem {
  const percent = job.size > 0 ? Math.min(100, Math.round((job.uploadedBytes / job.size) * 100)) : 0
  const prev = live.get(job.id)
  return {
    ...job,
    speedBps: extra?.speedBps ?? prev?.speedBps ?? 0,
    etaSeconds: extra?.etaSeconds ?? prev?.etaSeconds ?? null,
    percent: extra?.percent ?? percent,
  }
}

async function persist(job: PersistedUploadJob) {
  live.set(job.id, toLive(job))
  await saveJob(job)
  emit()
}

function noteProgress(job: PersistedUploadJob, loadedDelta: number, now = Date.now()) {
  const prev = speedEma.get(job.id) ?? 0
  const instant = loadedDelta > 0 ? loadedDelta : 0
  void now
  const ema = prev === 0 ? instant : prev * 0.82 + instant * 0.18
  speedEma.set(job.id, ema)
  const remain = Math.max(0, job.size - job.uploadedBytes)
  const etaSeconds = ema > 500 ? Math.round(remain / ema) : null
  live.set(job.id, toLive(job, { speedBps: ema, etaSeconds }))
  emit()
}

export async function enqueueFiles(files: File[], opts: { albumId: string | null; purpose?: 'content' | 'cover' }): Promise<string[]> {
  if (!userId || !accessToken) throw new Error('Not signed in')
  const purpose = opts.purpose ?? 'content'
  const ids: string[] = []
  for (const file of files) {
    const id = crypto.randomUUID()
    ids.push(id)
    const objectId = id
    const partsCount = Math.max(1, chunkCountForSize(file.size, CHUNK_PLAINTEXT_BYTES))
    if (partsCount > MAX_PARTS) {
      throw new Error(`${file.name} is too large for multipart (${partsCount} parts; max ${MAX_PARTS})`)
    }
    const job: PersistedUploadJob = {
      id,
      albumId: opts.albumId,
      purpose,
      fileName: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      objectId,
      storageKey: originalKey(userId, objectId),
      uploadId: null,
      parts: Array.from({ length: partsCount }, (_, i) => ({
        partNumber: i + 1,
        etag: null,
        bytes: Math.min(CHUNK_PLAINTEXT_BYTES, file.size - i * CHUNK_PLAINTEXT_BYTES),
        done: false,
      })),
      uploadedBytes: 0,
      state: 'queued',
      error: null,
      encryptionVersion: masterKey ? ENCRYPTION_VERSION : 0,
      fileNonceB64: null,
      wrappedDek: null,
      chunkSize: CHUNK_PLAINTEXT_BYTES,
      width: null,
      height: null,
      durationMs: null,
      capturedAt: null,
      createdAt: Date.now(),
    }
    filesInMemory.set(id, file)
    await persist(job)
  }
  void pump()
  return ids
}

export function pauseJob(id: string) {
  paused.add(id)
  abortByJob.get(id)?.abort()
  const job = live.get(id)
  if (job && job.state !== 'complete' && job.state !== 'failed') {
    const next = { ...job, state: 'paused' as UploadUiState }
    void persist(next)
  }
}

export function resumeJob(id: string) {
  paused.delete(id)
  const job = live.get(id)
  if (job && (job.state === 'paused' || job.state === 'failed' || job.state === 'needs-file')) {
    if (!filesInMemory.has(id)) {
      void persist({ ...job, state: 'needs-file', error: 'Reselect this file to resume (the browser cannot restore the original after reload).' })
      return
    }
    void persist({ ...job, state: 'queued', error: null })
    void pump()
  }
}

export function retryJob(id: string) {
  resumeJob(id)
}

export function attachFileForResume(id: string, file: File) {
  const job = live.get(id)
  if (!job) return
  if (file.size !== job.size || file.name !== job.fileName) {
    void persist({ ...job, error: 'Selected file does not match the paused upload (name/size).' })
    return
  }
  filesInMemory.set(id, file)
  paused.delete(id)
  void persist({ ...job, state: 'queued', error: null })
  void pump()
}

export async function cancelJob(id: string) {
  paused.add(id)
  abortByJob.get(id)?.abort()
  const job = live.get(id)
  if (job?.uploadId && job.storageKey && accessToken) {
    try {
      await apiMultipartAbort(createAuthFetch(accessToken), { key: job.storageKey, uploadId: job.uploadId })
    } catch {
      /* abort of in-progress multipart only; ignore if already completed */
    }
  }
  filesInMemory.delete(id)
  live.delete(id)
  await deleteJob(id)
  emit()
}

export function dismissCompleted() {
  for (const [id, job] of live) {
    if (job.state === 'complete') {
      live.delete(id)
      filesInMemory.delete(id)
      void deleteJob(id)
    }
  }
  emit()
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (true) {
      const queued = [...live.values()].filter((j) => j.state === 'queued' || j.state === 'retrying')
      const active = [...live.values()].filter((j) =>
        ['preparing', 'encrypting', 'uploading', 'finalizing'].includes(j.state),
      )
      const slots = Math.max(0, fileConcurrency() - active.length)
      if (slots === 0 || queued.length === 0) break
      const batch = queued.slice(0, slots)
      await Promise.all(batch.map((j) => runJob(j.id)))
    }
  } finally {
    pumping = false
    const more = [...live.values()].some((j) => j.state === 'queued' || j.state === 'retrying')
    const active = [...live.values()].some((j) =>
      ['preparing', 'encrypting', 'uploading', 'finalizing'].includes(j.state),
    )
    if (more && !active) void pump()
  }
}

async function runJob(id: string) {
  const start = live.get(id)
  if (!start || !userId || !accessToken) return
  if (paused.has(id)) return
  const file = filesInMemory.get(id)
  if (!file) {
    await persist({ ...start, state: 'needs-file', error: 'Reselect this file to resume after reload.' })
    return
  }
  const authFetch = createAuthFetch(accessToken)
  const ac = new AbortController()
  abortByJob.set(id, ac)

  let job: PersistedUploadJob = { ...start, state: 'preparing', error: null }
  await persist(job)

  try {
    const meta = await extractMediaMetadata(file)
    job = {
      ...job,
      width: meta.width,
      height: meta.height,
      durationMs: meta.durationMs,
      capturedAt: meta.capturedAt,
      type: file.type || meta.mime || job.type,
    }
    await persist(job)

    let dek: CryptoKey | null = null
    let fileNonce: Uint8Array | null = null
    if (masterKey && job.encryptionVersion === ENCRYPTION_VERSION) {
      job = { ...job, state: 'encrypting' }
      await persist(job)
      dek = await generateDek()
      const raw = await exportRawKey(dek)
      job.wrappedDek = await wrapDek(masterKey, raw)
      fileNonce = newFileNonce()
      job.fileNonceB64 = bytesToBase64(fileNonce)
      await persist(job)
    } else {
      job = { ...job, encryptionVersion: 0, wrappedDek: null, fileNonceB64: null }
    }

    const useMultipart = file.size > MULTIPART_THRESHOLD_BYTES || job.parts.length > 1
    job = { ...job, state: 'uploading' }
    await persist(job)

    if (!useMultipart) {
      const { uploadUrl, key } = await apiPutUrl(authFetch, {
        objectId: job.objectId,
        contentType: 'application/octet-stream',
        key: job.storageKey ?? undefined,
      })
      job.storageKey = key
      const body = await buildChunkBlob(file, 0, dek, fileNonce)
      const etag = await putWithRetry(uploadUrl, body, (loaded) => {
        job.uploadedBytes = loaded
        noteProgress(job, loaded)
      }, ac.signal)
      job.parts = [{ partNumber: 1, etag, bytes: file.size, done: true }]
      job.uploadedBytes = file.size
      await persist(job)
    } else {
      if (!job.uploadId) {
        const init = await apiMultipartInit(authFetch, {
          objectId: job.objectId,
          contentType: 'application/octet-stream',
          key: job.storageKey ?? undefined,
        })
        job.uploadId = init.uploadId
        job.storageKey = init.key
        await persist(job)
      }
      await uploadParts(job, file, dek, fileNonce, authFetch, ac.signal)
      job = live.get(id) ?? job
      job = { ...job, state: 'finalizing' }
      await persist(job)
      const parts = job.parts.filter((p) => p.done && p.etag).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag as string }))
      await apiMultipartComplete(authFetch, { key: job.storageKey!, uploadId: job.uploadId!, parts })
    }

    job = { ...job, state: 'finalizing', uploadedBytes: job.size }
    await persist(job)

    const thumb = file.type.startsWith('image/') ? await makeImageThumbnail(file) : null
    const poster = !thumb ? await makeVideoPoster(file) : null
    let thumbnailKey: string | null = null
    let posterKeyVal: string | null = null
    if (thumb) thumbnailKey = await uploadSidecar(authFetch, thumb, thumbKey(userId, `${job.objectId}-t`))
    if (poster) posterKeyVal = await uploadSidecar(authFetch, poster, posterKey(userId, `${job.objectId}-p`))

    const insert = {
      id: job.objectId,
      user_id: userId,
      album_id: job.albumId,
      file_name: job.fileName,
      file_url: `r2://${job.storageKey}`,
      file_size_bytes: job.size,
      purpose: job.purpose,
      is_encrypted: job.encryptionVersion > 0,
      mime_type: job.type,
      storage_key: job.storageKey,
      storage_provider: 'r2',
      upload_status: 'ready',
      width: job.width,
      height: job.height,
      duration_ms: job.durationMs,
      captured_at: job.capturedAt,
      favorite: false,
      thumbnail_key: thumbnailKey,
      poster_key: posterKeyVal,
      encryption_version: job.encryptionVersion,
      wrapped_dek: job.wrappedDek,
      encryption_chunk_size: job.encryptionVersion > 0 ? CHUNK_PLAINTEXT_BYTES : null,
      metadata_json: {
        fileNonce: job.fileNonceB64,
      },
    }

    const { error: insErr } = await supabase.from('files').upsert(insert, { onConflict: 'id', ignoreDuplicates: true })
    if (insErr) {
      try {
        await apiRecordOrphan(authFetch, {
          storageKey: job.storageKey!,
          originalName: job.fileName,
          fileSizeBytes: job.size,
          uploadId: job.uploadId ?? undefined,
          error: insErr.message,
        })
      } catch {
        /* still fail the job */
      }
      throw new Error(`Stored in R2 but catalog insert failed: ${insErr.message}`)
    }

    if (job.albumId) {
      await supabase.from('album_files').upsert(
        { album_id: job.albumId, file_id: job.objectId, user_id: userId },
        { onConflict: 'album_id,file_id' },
      )
    }

    job = { ...job, state: 'complete', uploadedBytes: job.size, error: null }
    await persist(job)
    filesInMemory.delete(id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed'
    if (paused.has(id) || msg.includes('paused') || msg.includes('cancelled')) {
      const cur = live.get(id)
      if (cur) await persist({ ...cur, state: 'paused' })
      return
    }
    const cur = live.get(id)
    if (cur) await persist({ ...cur, state: 'failed', error: msg })
  } finally {
    abortByJob.delete(id)
  }
}

async function buildChunkBlob(
  file: File,
  index: number,
  dek: CryptoKey | null,
  fileNonce: Uint8Array | null,
): Promise<Blob> {
  const start = index * CHUNK_PLAINTEXT_BYTES
  const end = Math.min(file.size, start + CHUNK_PLAINTEXT_BYTES)
  const plain = await readFileSlice(file, start, end)
  if (dek && fileNonce) {
    const ct = await encryptChunk(dek, fileNonce, index, plain)
    return new Blob([ct], { type: 'application/octet-stream' })
  }
  return new Blob([plain], { type: 'application/octet-stream' })
}

async function uploadParts(
  initial: PersistedUploadJob,
  file: File,
  dek: CryptoKey | null,
  fileNonce: Uint8Array | null,
  authFetch: ReturnType<typeof createAuthFetch>,
  signal: AbortSignal,
) {
  const id = initial.id
  const pending = () => (live.get(id)?.parts ?? []).filter((p) => !p.done).map((p) => p.partNumber)
  const limit = partConcurrency()

  async function runPart(partNumber: number) {
    if (paused.has(id)) throw new Error('Upload paused or cancelled')
    const job = live.get(id)
    if (!job?.storageKey || !job.uploadId) throw new Error('Missing multipart session')
    const { url } = await apiMultipartPartUrl(authFetch, {
      key: job.storageKey,
      uploadId: job.uploadId,
      partNumber,
    })
    const body = await buildChunkBlob(file, partNumber - 1, dek, fileNonce)
    const etag = await putWithRetry(url, body, () => {
      /* per-part; overall updated after */
    }, signal)
    const latest = live.get(id)!
    const partBytes = latest.parts.find((x) => x.partNumber === partNumber)?.bytes ?? 0
    const parts = latest.parts.map((part) =>
      part.partNumber === partNumber ? { ...part, etag, done: true } : part,
    )
    const uploadedBytes = parts.filter((part) => part.done).reduce((s, part) => s + part.bytes, 0)
    const next = { ...latest, parts, uploadedBytes, state: 'uploading' as UploadUiState }
    noteProgress(next, partBytes)
    await persist(next)
  }

  const queue = pending()
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      const n = queue[cursor++]
      if (n == null) return
      await runPart(n)
    }
  }
  const workers = Array.from({ length: Math.min(limit, queue.length) }, () => worker())
  await Promise.all(workers)
}

async function uploadSidecar(authFetch: ReturnType<typeof createAuthFetch>, blob: Blob, key: string) {
  const objectId = key.split('/').pop() || crypto.randomUUID()
  const { uploadUrl, key: outKey } = await apiPutUrl(authFetch, {
    objectId,
    contentType: blob.type || 'image/jpeg',
    key,
  })
  await putWithRetry(uploadUrl, blob, () => {})
  return outKey
}

export function batchTotals(items: LiveUploadItem[]) {
  const total = items.length
  const completed = items.filter((i) => i.state === 'complete').length
  const totalBytes = items.reduce((s, i) => s + i.size, 0)
  const uploadedBytes = items.reduce((s, i) => s + Math.min(i.uploadedBytes, i.size), 0)
  const active = items.filter((i) => ['uploading', 'encrypting', 'preparing', 'finalizing', 'retrying'].includes(i.state))
  const speed = active.reduce((s, i) => s + i.speedBps, 0)
  const remain = Math.max(0, totalBytes - uploadedBytes)
  const etaSeconds = speed > 500 ? Math.round(remain / speed) : null
  const percent = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0
  return { total, completed, totalBytes, uploadedBytes, speed, etaSeconds, percent }
}
