import type { MutableRefObject } from 'react'
import { supabase } from './supabase'

/** Max single-file size before upload (approximate safety limit). */
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024

export type BatchUploadProgress = {
  progress: number
  fileName: string | null
  batchIndex: number
  batchTotal: number
  etaText: string | null
  currentFileIndex: number
  currentFilePercent?: number
}

export type FilePurpose = 'content' | 'cover'

export type BatchUploadResult = {
  failed: string[]
  total: number
  fileIds: (string | null)[]
  errors: (string | null)[]
}

type Refs = {
  uploadStartMsRef: MutableRefObject<number>
  uploadTotalBytesRef: MutableRefObject<number>
}

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

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}

/**
 * Upload cover image/video: raw file bytes to R2, public URL in DB.
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

  refs.uploadTotalBytesRef.current = Math.max(1, file.size)
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

  await putBlobToR2(file, uploadUrl, (loaded, tot) => {
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
      is_encrypted: false,
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

/**
 * Upload files one at a time: raw bytes to R2, public URLs in DB (not encrypted).
 */
export async function batchUploadFilesToAlbum(
  filesArray: File[],
  albumId: string,
  userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
  options?: { purpose?: FilePurpose },
): Promise<BatchUploadResult> {
  const purpose: FilePurpose = options?.purpose ?? 'content'
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

  const estimatedBytes = filesArray.reduce((s, f) => s + f.size, 0)
  refs.uploadTotalBytesRef.current = Math.max(1, Math.round(estimatedBytes))
  refs.uploadStartMsRef.current = Date.now()

  const failed: string[] = []
  const fileIds: (string | null)[] = new Array(total).fill(null)
  const errors: (string | null)[] = new Array(total).fill(null)
  const weight = new Float64Array(total)

  const emitProgress = (fileIndexZeroBased: number, fileName: string | null, currentFilePercent?: number) => {
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

  onProgress({
    progress: 0,
    fileName: filesArray[0]?.name ?? null,
    batchIndex: 1,
    batchTotal: total,
    etaText: null,
    currentFileIndex: 1,
    currentFilePercent: 0,
  })

  for (let fileIndex = 0; fileIndex < total; fileIndex++) {
    const file = filesArray[fileIndex]!
    weight[fileIndex] = 0.05
    emitProgress(fileIndex, file.name, 5)

    try {
      const { uploadUrl, fileUrl } = await presignUpload(file.name)

      await putBlobToR2(file, uploadUrl, (loaded, tot) => {
        const frac = tot > 0 ? loaded / tot : 1
        weight[fileIndex] = 0.05 + frac * 0.9
        const filePct = Math.min(99, Math.round(5 + frac * 90))
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
          is_encrypted: false,
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
