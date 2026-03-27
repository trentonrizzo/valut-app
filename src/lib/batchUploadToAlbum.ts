import type { MutableRefObject } from 'react'
import { supabase } from './supabase'
import { encryptFile, ensureEncryptionKey } from './vaultCrypto'
import { isVideoFileName } from './mediaTypes'

/** Max single-file size before upload (approximate safety limit). */
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024

/** Videos at or above this size run with at most one concurrent large-video job (plus one smaller file). */
export const LARGE_VIDEO_BYTES = 32 * 1024 * 1024

export function isLargeVideoFile(file: File): boolean {
  return isVideoFileName(file.name) && file.size >= LARGE_VIDEO_BYTES
}

export type BatchUploadProgress = {
  progress: number
  fileName: string | null
  batchIndex: number
  batchTotal: number
  etaText: string | null
  /** 1-based index of the file currently being processed */
  currentFileIndex: number
  /** 0–100 for the active file only (encrypt + upload) */
  currentFilePercent?: number
}

export type BatchUploadFilePhase = 'preparing' | 'uploading'

export type FilePurpose = 'content' | 'cover'

export type BatchUploadResult = {
  failed: string[]
  total: number
  /** Same order as input files; null where that index failed */
  fileIds: (string | null)[]
  /** Human-readable error per index, or null if ok */
  errors: (string | null)[]
}

type Refs = {
  uploadStartMsRef: MutableRefObject<number>
  uploadTotalBytesRef: MutableRefObject<number>
}

/** Returns false if any file exceeds the limit (shows alert). */
export function validateUploadFileSizes(files: File[]): boolean {
  for (const f of files) {
    if (f.size > MAX_UPLOAD_FILE_BYTES) {
      globalThis.alert(`File too large. Max 200MB for now.\n\n${f.name}`)
      return false
    }
  }
  return true
}

async function presignUpload(fileName: string): Promise<{ uploadUrl: string; fileUrl: string }> {
  const presignRes = await fetch('/api/r2-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  })

  const presign = await presignRes.json()

  if (!presignRes.ok || presign?.ok !== true || !presign.uploadUrl || !presign.fileUrl) {
    throw new Error(presign?.error || 'Could not create upload URL')
  }

  return presign as { uploadUrl: string; fileUrl: string }
}

/**
 * Upload blob to R2 via presigned PUT. Progress is per-file (loaded/total for this upload).
 */
async function putBlobToR2(
  body: Blob,
  uploadUrl: string,
  onChunkProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const total = body.size
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || total <= 0) return
      onChunkProgress(event.loaded, total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onChunkProgress(total, total)
        resolve()
      } else reject(new Error(`Upload failed (${xhr.status})`))
    }

    xhr.onerror = () => reject(new Error('Upload failed'))

    xhr.send(body)
  })
}

function canStartWithActive(file: File, activeChosen: File[]): boolean {
  if (activeChosen.length >= 2) return false
  const largeActive = activeChosen.filter(isLargeVideoFile).length
  if (isLargeVideoFile(file) && largeActive >= 1) return false
  return true
}

/**
 * Pick next batch (max 2 files) that may run in parallel respecting large-video rule.
 */
function pickNextBatch(filesArray: File[], pending: number[]): number[] {
  const batch: number[] = []
  for (const i of [...pending]) {
    const chosen = batch.map((idx) => filesArray[idx]!)
    if (canStartWithActive(filesArray[i]!, chosen)) {
      batch.push(i)
      if (batch.length >= 2) break
    }
  }
  for (const i of batch) {
    const pos = pending.indexOf(i)
    if (pos !== -1) pending.splice(pos, 1)
  }
  return batch
}

/**
 * Upload one encrypted file to R2, insert as purpose=cover, set albums.cover_file_id.
 */
export async function uploadCoverAndSetAlbum(
  file: File,
  albumId: string,
  userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
): Promise<{ fileId: string }> {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    globalThis.alert(`File too large. Max 200MB for now.\n\n${file.name}`)
    throw new Error('File too large')
  }

  const key = await ensureEncryptionKey(userId)
  const encryptedBlob = await encryptFile(file, key)
  const totalBytes = encryptedBlob.size
  refs.uploadTotalBytesRef.current = totalBytes
  refs.uploadStartMsRef.current = Date.now()

  onProgress({
    progress: 0,
    fileName: file.name,
    batchIndex: 1,
    batchTotal: 1,
    etaText: null,
    currentFileIndex: 1,
    currentFilePercent: 0,
  })

  const { uploadUrl, fileUrl } = await presignUpload(file.name)

  await putBlobToR2(encryptedBlob, uploadUrl, (loaded, tot) => {
    const pct = Math.min(100, Math.round((loaded / tot) * 100))
    let etaText: string | null = null
    const elapsed = Date.now() - refs.uploadStartMsRef.current
    if (elapsed > 2500 && pct > 2 && pct < 99) {
      const rate = loaded / elapsed
      if (rate > 0) {
        const remainingMs = (tot - loaded) / rate
        if (remainingMs > 4000 && remainingMs < 1000 * 60 * 60 * 4) {
          const sec = Math.ceil(remainingMs / 1000)
          etaText = sec < 60 ? `~${sec}s left` : `~${Math.round(sec / 60)}m left`
        }
      }
    }
    onProgress({
      progress: pct,
      fileName: file.name,
      batchIndex: 1,
      batchTotal: 1,
      etaText,
      currentFileIndex: 1,
      currentFilePercent: pct,
    })
  })

  const { data, error: insertError } = await supabase
    .from('files')
    .insert({
      user_id: userId,
      album_id: albumId,
      file_name: file.name,
      file_url: fileUrl,
      file_size_bytes: file.size,
      purpose: 'cover',
      is_encrypted: true,
      mime_type: file.type || null,
    })
    .select('id')
    .single()

  if (insertError) throw new Error(insertError.message)
  if (!data?.id) throw new Error('Insert did not return file id')

  const { error: albumErr } = await supabase
    .from('albums')
    .update({ cover_file_id: data.id })
    .eq('id', albumId)
    .eq('user_id', userId)

  if (albumErr) throw new Error(albumErr.message)

  onProgress({
    progress: 100,
    fileName: file.name,
    batchIndex: 1,
    batchTotal: 1,
    etaText: null,
    currentFileIndex: 1,
    currentFilePercent: 100,
  })

  return { fileId: data.id }
}

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}

/**
 * Uploads files to R2 + inserts metadata (encrypted ciphertext).
 * Runs in waves of up to 2 files; at most one large video (≥32MB) per wave.
 */
export async function batchUploadFilesToAlbum(
  filesArray: File[],
  albumId: string,
  userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
  options?: {
    purpose?: FilePurpose
    onFilePhase?: (fileIndex: number, phase: BatchUploadFilePhase) => void
  },
): Promise<BatchUploadResult> {
  const purpose: FilePurpose = options?.purpose ?? 'content'
  const onFilePhase = options?.onFilePhase
  const total = filesArray.length
  if (total === 0) {
    return { failed: [], total: 0, fileIds: [], errors: [] }
  }

  if (!validateUploadFileSizes(filesArray)) {
    return {
      failed: filesArray.map((f) => f.name),
      total,
      fileIds: new Array(total).fill(null),
      errors: filesArray.map(() => 'File too large'),
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })

  const key = await ensureEncryptionKey(userId)

  const estimatedBytes = filesArray.reduce((s, f) => s + f.size, 0) * 1.08
  refs.uploadTotalBytesRef.current = Math.max(1, Math.round(estimatedBytes))
  refs.uploadStartMsRef.current = Date.now()

  const failed: string[] = []
  const fileIds: (string | null)[] = new Array(total).fill(null)
  const errors: (string | null)[] = new Array(total).fill(null)
  /** Per-file completion weight 0–1 for overall progress */
  const weight = new Float64Array(total)

  const emitProgress = (
    fileIndexZeroBased: number,
    fileName: string | null,
    currentFilePercent?: number,
  ) => {
    let sum = 0
    for (let w = 0; w < weight.length; w++) sum += weight[w]!
    const pct = Math.min(99, Math.round((sum / total) * 100))
    let etaText: string | null = null
    const elapsed = Date.now() - refs.uploadStartMsRef.current
    if (elapsed > 2500 && pct > 2 && pct < 99) {
      const doneApprox = (sum / total) * estimatedBytes
      const rate = doneApprox / elapsed
      if (rate > 0) {
        const remainingMs = (estimatedBytes - doneApprox) / rate
        if (remainingMs > 4000 && remainingMs < 1000 * 60 * 60 * 4) {
          const sec = Math.ceil(remainingMs / 1000)
          etaText = sec < 60 ? `~${sec}s left` : `~${Math.round(sec / 60)}m left`
        }
      }
    }
    onProgress({
      progress: pct,
      fileName,
      batchIndex: fileIndexZeroBased + 1,
      batchTotal: total,
      etaText,
      currentFileIndex: fileIndexZeroBased + 1,
      currentFilePercent,
    })
  }

  async function uploadSingleFile(fileIndex: number): Promise<void> {
    const file = filesArray[fileIndex]!

    weight[fileIndex] = 0.02
    emitProgress(fileIndex, file.name, 2)
    onFilePhase?.(fileIndex, 'preparing')

    let encryptedBlob: Blob
    try {
      encryptedBlob = await encryptFile(file, key)
    } catch (e) {
      const msg = humanError(e)
      failed.push(file.name)
      errors[fileIndex] = `Could not encrypt: ${msg}`
      weight[fileIndex] = 0
      console.error('Encrypt failed for file:', file.name, e)
      emitProgress(fileIndex, file.name, 0)
      return
    }

    onFilePhase?.(fileIndex, 'uploading')
    weight[fileIndex] = 0.1
    emitProgress(fileIndex, file.name, 12)

    try {
      const { uploadUrl, fileUrl } = await presignUpload(file.name)

      await putBlobToR2(encryptedBlob, uploadUrl, (loaded, tot) => {
        const frac = tot > 0 ? loaded / tot : 1
        weight[fileIndex] = 0.1 + frac * 0.85
        const filePct = Math.min(99, Math.round(12 + frac * 88))
        emitProgress(fileIndex, file.name, filePct)
      })

      const { data, error: insertError } = await supabase
        .from('files')
        .insert({
          user_id: userId,
          album_id: albumId,
          file_name: file.name,
          file_url: fileUrl,
          file_size_bytes: file.size,
          purpose,
          is_encrypted: true,
          mime_type: file.type || null,
        })
        .select('id')
        .single()

      if (insertError) throw new Error(insertError.message)
      if (!data?.id) throw new Error('Insert did not return file id')

      fileIds[fileIndex] = data.id
      weight[fileIndex] = 1
      emitProgress(fileIndex, file.name, 100)
    } catch (e) {
      const msg = humanError(e)
      failed.push(file.name)
      errors[fileIndex] = msg
      weight[fileIndex] = 0
      console.error('Upload failed for file:', file.name, e)
      emitProgress(fileIndex, file.name, 0)
    }
  }

  const pending = [...Array(total).keys()]

  onProgress({
    progress: 0,
    fileName: filesArray[0]?.name ?? null,
    batchIndex: 1,
    batchTotal: total,
    etaText: null,
    currentFileIndex: 1,
    currentFilePercent: 0,
  })

  while (pending.length > 0) {
    const batch = pickNextBatch(filesArray, pending)
    if (batch.length === 0) {
      console.error('batchUploadFilesToAlbum: could not schedule remaining files', pending)
      for (const i of pending) {
        const file = filesArray[i]!
        failed.push(file.name)
        errors[i] = 'Could not schedule upload'
        weight[i] = 0
      }
      break
    }
    await Promise.all(batch.map((i) => uploadSingleFile(i)))
  }

  onProgress({
    progress: 100,
    fileName: filesArray[filesArray.length - 1]?.name ?? null,
    batchIndex: total,
    batchTotal: total,
    etaText: null,
    currentFileIndex: total,
    currentFilePercent: 100,
  })

  return { failed, total, fileIds, errors }
}
