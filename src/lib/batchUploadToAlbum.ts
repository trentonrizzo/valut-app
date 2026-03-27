import type { MutableRefObject } from 'react'
import { supabase } from './supabase'
import { encryptFile, ensureEncryptionKey } from './vaultCrypto'

export type BatchUploadProgress = {
  progress: number
  fileName: string | null
  batchIndex: number
  batchTotal: number
  etaText: string | null
}

export type FilePurpose = 'content' | 'cover'

export type BatchUploadResult = {
  failed: string[]
  total: number
  /** Same order as input files; null where that index failed */
  fileIds: (string | null)[]
}

type Refs = {
  uploadStartMsRef: MutableRefObject<number>
  uploadTotalBytesRef: MutableRefObject<number>
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
  totalBytesAll: number,
  fileStartOffset: number,
  index: number,
  total: number,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
  fileName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || totalBytesAll <= 0) return
      const totalDone = fileStartOffset + event.loaded
      const overallPct = Math.round((totalDone / totalBytesAll) * 100)

      let etaText: string | null = null
      const elapsed = Date.now() - refs.uploadStartMsRef.current
      if (elapsed > 2500 && overallPct > 2 && overallPct < 99) {
        const rate = totalDone / elapsed
        if (rate > 0) {
          const remainingMs = (totalBytesAll - totalDone) / rate
          if (remainingMs > 4000 && remainingMs < 1000 * 60 * 60 * 4) {
            const sec = Math.ceil(remainingMs / 1000)
            etaText = sec < 60 ? `~${sec}s left` : `~${Math.round(sec / 60)}m left`
          }
        }
      }

      onProgress({
        progress: Math.min(100, overallPct),
        fileName,
        batchIndex: index,
        batchTotal: total,
        etaText,
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }

    xhr.onerror = () => reject(new Error('Upload failed'))

    xhr.send(body)
  })
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
  })

  const { uploadUrl, fileUrl } = await presignUpload(file.name)

  await putBlobToR2(
    encryptedBlob,
    uploadUrl,
    totalBytes,
    0,
    1,
    1,
    refs,
    onProgress,
    file.name,
  )

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
  })

  return { fileId: data.id }
}

/**
 * Uploads files to R2 + inserts metadata (encrypted ciphertext). Uploads run in parallel.
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
    return { failed: [], total: 0, fileIds: [] }
  }

  const key = await ensureEncryptionKey(userId)

  const encryptedParts = await Promise.all(
    filesArray.map(async (file) => ({
      blob: await encryptFile(file, key),
      file,
    })),
  )

  const totalBytes = encryptedParts.reduce((s, x) => s + x.blob.size, 0)
  refs.uploadTotalBytesRef.current = totalBytes
  refs.uploadStartMsRef.current = Date.now()

  const offsets: number[] = []
  let off = 0
  for (const { blob } of encryptedParts) {
    offsets.push(off)
    off += blob.size
  }

  onProgress({
    progress: 0,
    fileName: filesArray[0]?.name ?? null,
    batchIndex: 1,
    batchTotal: total,
    etaText: null,
  })

  const failed: string[] = []
  const fileIds: (string | null)[] = new Array(total).fill(null)

  const settled = await Promise.allSettled(
    encryptedParts.map(async ({ blob, file }, i) => {
      const index = i + 1
      const { uploadUrl, fileUrl } = await presignUpload(file.name)

      await putBlobToR2(
        blob,
        uploadUrl,
        totalBytes,
        offsets[i],
        index,
        total,
        refs,
        onProgress,
        file.name,
      )

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

      return data.id
    }),
  )

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.status === 'fulfilled') {
      fileIds[i] = r.value
    } else {
      failed.push(filesArray[i].name)
      console.error('Upload failed for file:', filesArray[i].name, r.reason)
    }
  }

  onProgress({
    progress: 100,
    fileName: filesArray[filesArray.length - 1]?.name ?? null,
    batchIndex: total,
    batchTotal: total,
    etaText: null,
  })

  return { failed, total, fileIds }
}
