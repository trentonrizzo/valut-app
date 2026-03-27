import type { MutableRefObject } from 'react'
import { supabase } from './supabase'

export type BatchUploadProgress = {
  progress: number
  fileName: string | null
  batchIndex: number
  batchTotal: number
  etaText: string | null
}

type Refs = {
  uploadStartMsRef: MutableRefObject<number>
  uploadTotalBytesRef: MutableRefObject<number>
}

/**
 * Uploads files to R2 + inserts metadata. Same behavior as the in-album Dashboard flow.
 */
export async function batchUploadFilesToAlbum(
  filesArray: File[],
  albumId: string,
  userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
): Promise<{ failed: string[]; total: number }> {
  const total = filesArray.length
  const totalBytes = filesArray.reduce((s, f) => s + f.size, 0)
  refs.uploadTotalBytesRef.current = totalBytes
  refs.uploadStartMsRef.current = Date.now()

  let index = 0
  let completedBytes = 0
  const failed: string[] = []

  onProgress({
    progress: 0,
    fileName: filesArray[0]?.name ?? null,
    batchIndex: 1,
    batchTotal: total,
    etaText: null,
  })

  for (const file of filesArray) {
    index += 1
    onProgress({
      progress: Math.round(((index - 1) / total) * 100),
      fileName: file.name,
      batchIndex: index,
      batchTotal: total,
      etaText: null,
    })

    try {
      const presignRes = await fetch('/api/r2-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      })

      const presign = await presignRes.json()

      if (!presignRes.ok || presign?.ok !== true || !presign.uploadUrl || !presign.fileUrl) {
        throw new Error(presign?.error || 'Could not create upload URL')
      }

      const { uploadUrl, fileUrl } = presign as { uploadUrl: string; fileUrl: string }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl, true)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || totalBytes <= 0) return
          const currentFileBytes = (event.loaded / event.total) * file.size
          const totalDone = completedBytes + currentFileBytes
          const overallPct = Math.round((totalDone / totalBytes) * 100)

          let etaText: string | null = null
          const elapsed = Date.now() - refs.uploadStartMsRef.current
          if (elapsed > 2500 && overallPct > 2 && overallPct < 99) {
            const rate = totalDone / elapsed
            if (rate > 0) {
              const remainingMs = (totalBytes - totalDone) / rate
              if (remainingMs > 4000 && remainingMs < 1000 * 60 * 60 * 4) {
                const sec = Math.ceil(remainingMs / 1000)
                etaText = sec < 60 ? `~${sec}s left` : `~${Math.round(sec / 60)}m left`
              }
            }
          }

          onProgress({
            progress: Math.min(100, overallPct),
            fileName: file.name,
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

        xhr.send(file)
      })

      completedBytes += file.size

      const { error: insertError } = await supabase.from('files').insert({
        user_id: userId,
        album_id: albumId,
        file_name: file.name,
        file_url: fileUrl,
        file_size_bytes: file.size,
      })

      if (insertError) throw new Error(insertError.message)
    } catch (err) {
      failed.push(file.name)
      console.error('Upload failed for file:', file.name, err)
    }
  }

  onProgress({
    progress: 100,
    fileName: filesArray[filesArray.length - 1]?.name ?? null,
    batchIndex: total,
    batchTotal: total,
    etaText: null,
  })

  return { failed, total }
}
