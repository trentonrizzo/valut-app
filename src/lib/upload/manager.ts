import { supabase } from '../supabase'
import { originalKey, posterKey, thumbKey } from '../storageKeys'
import {
  CHUNK_PLAINTEXT_BYTES,
  ENCRYPTION_VERSION,
  encryptChunk,
  generateDek,
  newFileNonce,
  readFileSlice,
  exportRawKey,
  importDek,
} from '../crypto/chunkCipher'
import { wrapDek, unwrapDek, bytesToBase64, base64ToBytes } from '../crypto/envelope'
import { toArrayBuffer } from '../crypto/bytes'
import {
  createAuthFetch,
  apiPutUrl,
  apiMultipartInit,
  apiMultipartPartUrl,
  apiMultipartComplete,
  apiMultipartListParts,
  apiMultipartAbort,
  apiRecordOrphan,
  apiVerifyObject,
} from './storageApi'
import { deleteJob, listJobs, saveJob, type PersistedUploadJob, type UploadUiState } from './queueStore'
import { fileConcurrency, partConcurrency, putWithRetry } from './multipartConfig'
import { extractMediaMetadata, makeImageThumbnail, makeVideoPoster } from './extractMetadata'
import {
  canCatalogReady,
  canFinalizeWithoutFile,
  classifyUploadError,
  codedError,
  displayProgress,
  fileMatchesResume,
  isImageUpload,
  isVideoUpload,
  normalizeUploadMime,
  planUpload,
  providerLimitError,
  uniqueOriginalKey,
} from './strategy'
import { reconcilePersistedJob, shouldSkipByteUpload } from './finalizePolicy'
import { expectedVerifySize, storedObjectBytes } from './storedSize'
import { inspectSelectedFile, logUploadSelection } from './selectFiles'

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
const progressMark = new Map<string, { t: number; bytes: number }>()

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
    if (j.state === 'complete' || j.dbComplete) {
      await deleteJob(j.id)
      live.delete(j.id)
      continue
    }
    if (live.has(j.id) && filesInMemory.has(j.id)) continue

    const hasFile = filesInMemory.has(j.id)
    const rec = reconcilePersistedJob(j, hasFile)
    live.set(
      j.id,
      toLive({
        ...j,
        state: rec.state,
        error: rec.error,
        errorCode: rec.state === 'needs-file' ? 'ERR_NEEDS_FILE' : j.errorCode ?? null,
      }),
    )
  }
  emit()
  void pump()
}

function toLive(job: PersistedUploadJob, extra?: Partial<LiveUploadItem>): LiveUploadItem {
  const ui = displayProgress(job)
  const prev = live.get(job.id)
  return {
    ...job,
    speedBps: extra?.speedBps ?? prev?.speedBps ?? 0,
    etaSeconds: extra?.etaSeconds ?? (ui.showEta ? (prev?.etaSeconds ?? null) : null),
    percent: extra?.percent ?? ui.percent,
  }
}

async function persist(job: PersistedUploadJob) {
  live.set(job.id, toLive(job))
  await saveJob(job)
  emit()
}

function noteProgress(job: PersistedUploadJob, uploadedBytes: number, now = Date.now()) {
  const prev = progressMark.get(job.id)
  let ema = speedEma.get(job.id) ?? 0
  if (prev && now > prev.t && uploadedBytes >= prev.bytes) {
    const inst = ((uploadedBytes - prev.bytes) * 1000) / (now - prev.t)
    ema = ema === 0 ? inst : ema * 0.78 + inst * 0.22
  }
  progressMark.set(job.id, { t: now, bytes: uploadedBytes })
  speedEma.set(job.id, ema)
  const remain = Math.max(0, job.size - uploadedBytes)
  const ui = displayProgress(job)
  const etaSeconds = ui.showEta && ema > 500 ? Math.round(remain / ema) : null
  live.set(job.id, toLive(job, { speedBps: ema, etaSeconds, percent: ui.percent }))
  emit()
}

export async function enqueueFiles(files: File[], opts: { albumId: string | null; purpose?: 'content' | 'cover' }): Promise<string[]> {
  if (!userId || !accessToken) throw new Error('Not signed in')
  const purpose = opts.purpose ?? 'content'
  const ids: string[] = []
  let n = 0
  for (const file of files) {
    const limit = providerLimitError(file.size)
    if (limit) throw codedError('ERR_PROVIDER_LIMIT', `${file.name}: ${limit}`)
    const id = crypto.randomUUID()
    ids.push(id)
    const objectId = id
    const inspected = inspectSelectedFile(file)
    const mime = inspected.type
    const plan = planUpload(file.size)
    const encrypted = Boolean(masterKey)
    const storedSize = storedObjectBytes(file.size, encrypted, plan.partSize || CHUNK_PLAINTEXT_BYTES)
    logUploadSelection('enqueue', {
      name: inspected.name,
      size: inspected.size,
      type: inspected.type,
      extension: inspected.extension,
      lastModified: inspected.lastModified,
      albumId: opts.albumId,
      purpose,
      strategy: plan.useMultipart ? 'multipart' : 'simple',
      partCount: plan.parts.length,
      encrypted,
      storedSize,
    })
    const job: PersistedUploadJob = {
      id,
      albumId: opts.albumId,
      purpose,
      fileName: file.name,
      size: file.size,
      storedSize,
      type: mime,
      objectId,
      storageKey: uniqueOriginalKey(userId, objectId),
      uploadId: null,
      parts: plan.parts.map((p) => ({ ...p, etag: null, done: false })),
      uploadedBytes: 0,
      state: 'queued',
      error: null,
      encryptionVersion: masterKey ? ENCRYPTION_VERSION : 0,
      fileNonceB64: null,
      wrappedDek: null,
      chunkSize: plan.partSize || CHUNK_PLAINTEXT_BYTES,
      width: null,
      height: null,
      durationMs: null,
      capturedAt: null,
      createdAt: Date.now(),
      r2Complete: false,
      r2Verified: false,
      verifiedSize: null,
      multipartComplete: false,
      dbComplete: false,
      albumComplete: false,
      errorCode: null,
      lastStage: 'queued',
      lastModified: file.lastModified,
    }
    filesInMemory.set(id, file)
    await persist(job)
    n += 1
    if (n % 8 === 0) await new Promise<void>((r) => setTimeout(r, 0))
  }
  void pump()
  return ids
}

export function pauseJob(id: string) {
  paused.add(id)
  abortByJob.get(id)?.abort()
  const job = live.get(id)
  if (job && job.state !== 'complete' && job.state !== 'failed' && job.state !== 'needs-file') {
    void persist({ ...job, state: 'paused', error: null })
  }
}

export function resumeJob(id: string) {
  paused.delete(id)
  const job = live.get(id)
  if (!job) return
  if (job.state !== 'paused' && job.state !== 'failed' && job.state !== 'needs-file' && job.state !== 'retrying') return
  if (!filesInMemory.has(id) && !canFinalizeWithoutFile(job)) {
    void persist({
      ...job,
      state: 'needs-file',
      errorCode: 'ERR_NEEDS_FILE',
      error: 'Reselect this file to resume missing bytes. The browser cannot restore the original File after reload.',
    })
    return
  }
  void persist({ ...job, state: 'retrying', error: null, errorCode: null })
  void pump()
}

export function retryJob(id: string) {
  resumeJob(id)
}

export function retryAllFailed() {
  for (const job of live.values()) {
    if (job.state === 'failed' || job.state === 'needs-file' || job.state === 'paused') retryJob(job.id)
  }
}

export function attachFileForResume(id: string, file: File) {
  const job = live.get(id)
  if (!job) return
  const match = fileMatchesResume(file, job)
  if (!match.ok) {
    void persist({ ...job, errorCode: 'ERR_FILE_MISMATCH', error: match.reason })
    return
  }
  filesInMemory.set(id, file)
  paused.delete(id)
  void persist({
    ...job,
    type: normalizeUploadMime(file) || job.type,
    lastModified: file.lastModified,
    state: 'queued',
    error: null,
    errorCode: null,
  })
  void pump()
}

export async function cancelJob(id: string) {
  paused.add(id)
  abortByJob.get(id)?.abort()
  const job = live.get(id)
  if (job?.uploadId && job.storageKey && accessToken && !job.r2Complete && !job.multipartComplete) {
    try {
      await apiMultipartAbort(createAuthFetch(accessToken), { key: job.storageKey, uploadId: job.uploadId })
    } catch {
      /* abort in-progress multipart only; never delete a completed original */
    }
  }
  filesInMemory.delete(id)
  live.delete(id)
  await deleteJob(id)
  emit()
}

export function dismissCompleted() {
  for (const [id, job] of live) {
    if (job.state === 'complete' || job.dbComplete) {
      live.delete(id)
      filesInMemory.delete(id)
      void deleteJob(id)
    }
  }
  emit()
}

export function dismissFailed() {
  for (const [id, job] of live) {
    if (job.state === 'failed' || job.state === 'needs-file') {
      live.delete(id)
      filesInMemory.delete(id)
      void deleteJob(id)
    }
  }
  emit()
}

export function pauseAll() {
  for (const job of live.values()) {
    if (['queued', 'preparing', 'encrypting', 'uploading', 'finalizing', 'retrying'].includes(job.state)) {
      pauseJob(job.id)
    }
  }
}

export function resumeAll() {
  for (const job of live.values()) {
    if (job.state === 'paused') resumeJob(job.id)
  }
}

export function cancelQueued() {
  for (const job of [...live.values()]) {
    if (job.state === 'queued' || job.state === 'paused') void cancelJob(job.id)
  }
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
  const finalizeOnly = canFinalizeWithoutFile(start)
  if (!file && !finalizeOnly) {
    await persist({
      ...start,
      state: 'needs-file',
      errorCode: 'ERR_NEEDS_FILE',
      error: 'Reselect this file to resume missing bytes. The browser cannot restore the original File after reload.',
    })
    return
  }
  const authFetch = createAuthFetch(accessToken)
  const ac = new AbortController()
  abortByJob.set(id, ac)

  let job: PersistedUploadJob = { ...start, state: 'preparing', error: null, errorCode: null }
  await persist(job)

  try {
    if (file) {
      try {
        const meta = await extractMediaMetadata(file)
        logUploadSelection('metadata', {
          name: file.name,
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          mime: meta.mime,
        })
        job = {
          ...job,
          width: job.width ?? meta.width,
          height: job.height ?? meta.height,
          durationMs: job.durationMs ?? meta.durationMs,
          capturedAt: job.capturedAt ?? meta.capturedAt,
          type: normalizeUploadMime(file) || meta.mime || job.type,
        }
        await persist(job)
      } catch (metaErr) {
        logUploadSelection('metadata-failed', {
          name: file.name,
          error: metaErr instanceof Error ? metaErr.message : String(metaErr),
        })
      }
    }

    let dek: CryptoKey | null = null
    let fileNonce: Uint8Array | null = null
    const skipBytes = shouldSkipByteUpload(job) || job.r2Verified || finalizeOnly
    if (!skipBytes) {
      if (masterKey && job.encryptionVersion === ENCRYPTION_VERSION) {
        job = { ...job, state: 'encrypting' }
        await persist(job)
        if (job.wrappedDek && job.fileNonceB64) {
          const raw = await unwrapDek(masterKey, job.wrappedDek)
          dek = await importDek(raw)
          fileNonce = base64ToBytes(job.fileNonceB64)
        } else {
          dek = await generateDek()
          const raw = await exportRawKey(dek)
          job.wrappedDek = await wrapDek(masterKey, raw)
          fileNonce = newFileNonce()
          job.fileNonceB64 = bytesToBase64(fileNonce)
          job.storedSize = storedObjectBytes(job.size, true, job.chunkSize || CHUNK_PLAINTEXT_BYTES)
          await persist(job)
        }
      } else {
        job = { ...job, encryptionVersion: 0, wrappedDek: null, fileNonceB64: null, storedSize: job.size }
      }

      if (!file) throw codedError('ERR_NEEDS_FILE', 'File handle lost before bytes were stored.')

      const useMultipart = planUpload(file.size).useMultipart
      logUploadSelection('upload-start', {
        name: file.name,
        size: file.size,
        strategy: useMultipart ? 'multipart' : 'simple',
        storedSize: expectedVerifySize(job),
      })
      job = { ...job, state: 'uploading' }
      await persist(job)

      if (!useMultipart) {
        if (!job.parts[0]?.done) {
          const { uploadUrl, key } = await apiPutUrl(authFetch, {
            objectId: job.objectId,
            contentType: 'application/octet-stream',
            key: job.storageKey ?? originalKey(userId, job.objectId),
          })
          job.storageKey = key
          const body = await buildChunkBlob(file, 0, job.chunkSize || CHUNK_PLAINTEXT_BYTES, dek, fileNonce)
          await putWithRetry(
            uploadUrl,
            body,
            (loaded) => {
              job.uploadedBytes = loaded
              noteProgress({ ...job, uploadedBytes: loaded }, loaded)
            },
            { requireEtag: false, signal: ac.signal },
          )
          job.parts = [{ partNumber: 1, etag: 'put', bytes: file.size, done: true, acked: true }]
          job.uploadedBytes = file.size
        }
        job = { ...job, lastStage: 'simple-put', uploadedBytes: job.size }
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
      }
    }

    job = { ...job, state: 'finalizing', uploadedBytes: job.size, lastStage: 'r2_completing' }
    await persist(job)
    job = await assembleAndVerify(job, authFetch)
    if (!canCatalogReady(job)) {
      throw codedError('ERR_R2_VERIFY', 'R2 object was not verified; not adding to Library.')
    }

    job = { ...job, lastStage: 'cataloging' }
    await persist(job)

    let thumbnailKey: string | null = null
    let posterKeyVal: string | null = null
    if (file) {
      try {
        const thumb = isImageUpload(file) ? await makeImageThumbnail(file) : null
        const poster = !thumb && isVideoUpload(file) ? await makeVideoPoster(file) : null
        if (thumb) {
          thumbnailKey = await uploadSidecar(authFetch, thumb, thumbKey(userId, `${job.objectId}-t`)).catch(() => null)
        }
        if (poster) {
          posterKeyVal = await uploadSidecar(authFetch, poster, posterKey(userId, `${job.objectId}-p`)).catch(() => null)
        }
      } catch {
        /* sidecars are best-effort and must never fail a stored original */
      }
    }

    await finalizeCatalog(job, authFetch, { thumbnailKey, posterKeyVal })
    job = { ...job, state: 'complete', uploadedBytes: job.size, error: null, errorCode: null, dbComplete: true }
    await persist(job)
    filesInMemory.delete(id)
    await deleteJob(id)
    live.set(id, toLive(job))
    emit()
  } catch (e) {
    const classified = classifyUploadError(e, live.get(id)?.lastStage || 'upload')
    const msg = classified.message
    const code = classified.code
    if (paused.has(id) || code === 'ERR_PAUSED' || /paused|cancelled/i.test(msg)) {
      const cur = live.get(id)
      if (cur) await persist({ ...cur, state: 'paused' })
      return
    }
    const cur = live.get(id)
    if (cur) {
      await persist({
        ...cur,
        state: 'failed',
        errorCode: code,
        lastStage: cur.lastStage ?? classified.code,
        error: `${code}: ${msg}`,
      })
    }
  } finally {
    abortByJob.delete(id)
  }
}

async function finalizeCatalog(
  job: PersistedUploadJob,
  authFetch: ReturnType<typeof createAuthFetch>,
  extras: { thumbnailKey: string | null; posterKeyVal: string | null },
) {
  const insert = {
    id: job.objectId,
    user_id: userId,
    album_id: job.albumId,
    file_name: job.fileName,
    file_url: `r2://${job.storageKey}`,
    file_size_bytes: job.size,
    stored_size_bytes: expectedVerifySize(job),
    purpose: job.purpose,
    is_encrypted: job.encryptionVersion > 0,
    mime_type: job.type,
    storage_key: job.storageKey,
    storage_provider: 'r2',
    upload_status: 'ready' as const,
    width: job.width,
    height: job.height,
    duration_ms: job.durationMs,
    captured_at: job.capturedAt,
    favorite: false,
    thumbnail_key: extras.thumbnailKey,
    poster_key: extras.posterKeyVal,
    encryption_version: job.encryptionVersion,
    wrapped_dek: job.wrappedDek,
    encryption_chunk_size: job.encryptionVersion > 0 ? job.chunkSize || CHUNK_PLAINTEXT_BYTES : null,
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
    throw codedError('ERR_DB_INSERT', `Stored in R2 but catalog insert failed: ${insErr.message}`)
  }

  if (job.albumId) {
    const { error: albumErr } = await supabase.from('album_files').upsert(
      { album_id: job.albumId, file_id: job.objectId, user_id: userId },
      { onConflict: 'album_id,file_id' },
    )
    if (albumErr && !/duplicate|conflict|already/i.test(albumErr.message)) {
      throw codedError('ERR_ALBUM_ASSOCIATION', `Original stored, album link failed: ${albumErr.message}`)
    }
    job.albumComplete = true
  } else {
    job.albumComplete = true
  }
}

async function assembleAndVerify(
  initial: PersistedUploadJob,
  authFetch: ReturnType<typeof createAuthFetch>,
): Promise<PersistedUploadJob> {
  let job = initial
  if (job.r2Verified && job.verifiedSize === expectedVerifySize(job)) return job

  if (job.uploadId && job.storageKey && !job.multipartComplete) {
    const key = job.storageKey
    const uploadId = job.uploadId
    try {
      job = { ...job, lastStage: 'part-list' }
      await persist(job)
      const listed = await apiMultipartListParts(authFetch, { key, uploadId })
      if (!listed.parts.length) {
        throw codedError('ERR_MULTIPART_PARTS', 'R2 has no uploaded parts for this multipart session.')
      }
      if (listed.parts.length !== job.parts.length) {
        throw codedError(
          'ERR_MULTIPART_PARTS',
          `R2 listed ${listed.parts.length} parts; expected ${job.parts.length}. Retry missing parts.`,
        )
      }
      const parts = job.parts.map((p) => {
        const server = listed.parts.find((s) => s.PartNumber === p.partNumber)
        if (!server?.ETag) throw codedError('ERR_ETAG', `Missing ETag for part ${p.partNumber}`)
        return { ...p, etag: server.ETag, done: true, acked: true }
      })
      job = { ...job, parts, lastStage: 'multipart-complete' }
      await persist(job)
      const complete = await apiMultipartComplete(authFetch, {
        key,
        uploadId,
        expectedSize: expectedVerifySize(job),
        parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag as string })),
      })
      job = {
        ...job,
        multipartComplete: true,
        r2Complete: true,
        lastStage: 'r2_verifying',
        verifiedSize: complete.contentLength ?? null,
      }
      await persist(job)
    } catch (e) {
      try {
        const recovered = await apiVerifyObject(authFetch, {
          key,
          expectedSize: expectedVerifySize(job),
        })
        if (recovered.verified && recovered.contentLength === expectedVerifySize(job)) {
          job = {
            ...job,
            multipartComplete: true,
            r2Complete: true,
            r2Verified: true,
            verifiedSize: recovered.contentLength,
            lastStage: 'r2_verified',
          }
          await persist(job)
          return job
        }
      } catch {
        /* still fail with original complete/list error */
      }
      throw e
    }
  }

  if (!job.storageKey) throw codedError('ERR_R2_VERIFY', 'Missing storage key')
  const verifyKey = job.storageKey
  job = { ...job, lastStage: 'r2_verifying' }
  await persist(job)
  const expected = expectedVerifySize(job)
  const verified = await apiVerifyObject(authFetch, { key: verifyKey, expectedSize: expected })
  if (!verified.verified || verified.contentLength !== expected) {
    throw codedError('ERR_R2_SIZE', `R2 size ${verified.contentLength} != stored ${expected} (plaintext ${job.size})`)
  }
  job = {
    ...job,
    r2Complete: true,
    r2Verified: true,
    verifiedSize: verified.contentLength,
    lastStage: 'r2_verified',
  }
  await persist(job)
  return job
}

async function buildChunkBlob(
  file: File,
  index: number,
  chunkSize: number,
  dek: CryptoKey | null,
  fileNonce: Uint8Array | null,
): Promise<Blob> {
  const start = index * chunkSize
  const end = Math.min(file.size, start + chunkSize)
  const plain = await readFileSlice(file, start, end)
  if (dek && fileNonce) {
    const ct = await encryptChunk(dek, fileNonce, index, plain)
    return new Blob([toArrayBuffer(ct)], { type: 'application/octet-stream' })
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
  const pending = () => (live.get(id)?.parts ?? []).filter((p) => !p.done && !p.acked).map((p) => p.partNumber)
  const limit = partConcurrency()
  const chunkSize = initial.chunkSize || CHUNK_PLAINTEXT_BYTES

  async function runPart(partNumber: number) {
    if (paused.has(id)) throw codedError('ERR_PAUSED', 'Upload paused or cancelled')
    const job = live.get(id)
    if (!job?.storageKey || !job.uploadId) throw codedError('ERR_MULTIPART_SESSION', 'Missing multipart session')
    const sign = () =>
      apiMultipartPartUrl(authFetch, {
        key: job.storageKey!,
        uploadId: job.uploadId!,
        partNumber,
      }).then((r) => r.url)
    const url = await sign()
    const body = await buildChunkBlob(file, partNumber - 1, chunkSize, dek, fileNonce)
    const etag = await putWithRetry(url, body, (loaded) => {
      const latest = live.get(id)
      if (!latest) return
      const doneBytes = latest.parts.filter((p) => p.done).reduce((s, p) => s + p.bytes, 0)
      noteProgress(latest, doneBytes + loaded)
    }, {
      requireEtag: false,
      signal,
      refreshUrl: sign,
    })
    const latest = live.get(id)!
    const parts = latest.parts.map((part) =>
      part.partNumber === partNumber
        ? { ...part, etag: etag || part.etag, done: Boolean(etag || part.etag), acked: true }
        : part,
    )
    const uploadedBytes = parts.filter((part) => part.done || part.acked).reduce((s, part) => s + part.bytes, 0)
    const next = { ...latest, parts, uploadedBytes, state: 'uploading' as UploadUiState }
    noteProgress(next, uploadedBytes)
    await persist(next)
  }

  const queue = pending()
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      if (paused.has(id)) throw codedError('ERR_PAUSED', 'Upload paused or cancelled')
      const n = queue[cursor++]
      if (n == null) return
      await runPart(n)
    }
  }
  const workers = Array.from({ length: Math.min(limit, Math.max(1, queue.length)) }, () => worker())
  await Promise.all(workers)
}

async function uploadSidecar(authFetch: ReturnType<typeof createAuthFetch>, blob: Blob, key: string) {
  const objectId = key.split('/').pop() || crypto.randomUUID()
  const { uploadUrl, key: outKey } = await apiPutUrl(authFetch, {
    objectId,
    contentType: blob.type || 'image/jpeg',
    key,
  })
  await putWithRetry(uploadUrl, blob, () => {}, { requireEtag: false })
  return outKey
}

export function batchTotals(items: LiveUploadItem[]) {
  const total = items.length
  const completed = items.filter((i) => i.state === 'complete').length
  const failed = items.filter((i) => i.state === 'failed' || i.state === 'needs-file').length
  const totalBytes = items.reduce((s, i) => s + i.size, 0)
  const uploadedBytes = items.reduce((s, i) => s + Math.min(i.uploadedBytes, i.size), 0)
  const active = items.filter((i) =>
    ['uploading', 'encrypting', 'preparing', 'finalizing', 'retrying'].includes(i.state),
  )
  const allDone = items.every((i) => i.state === 'complete' || i.state === 'failed' || i.state === 'needs-file')
  const speed = active.reduce((s, i) => s + i.speedBps, 0)
  const remain = Math.max(0, totalBytes - uploadedBytes)
  const finalizing = active.some((i) => i.state === 'finalizing') && remain === 0
  const etaSeconds = !finalizing && speed > 500 ? Math.round(remain / speed) : null
  const percent = allDone && failed === 0 && total > 0
    ? 100
    : totalBytes > 0
      ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100))
      : 0
  return { total, completed, failed, totalBytes, uploadedBytes, speed, etaSeconds, percent }
}
