import type { MutableRefObject } from 'react'
import { supabase } from './supabase'
import { enqueueFiles, getLiveUploads, subscribeUploads, type LiveUploadItem } from './upload/manager'

/** No app-imposed file size cap. Kept as a no-op validator for call sites. */
export const MAX_UPLOAD_FILE_BYTES = Number.POSITIVE_INFINITY

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

export function validateUploadFileSizes(_files: File[]): boolean {
  return true
}

function waitForJobs(ids: string[], onProgress: (p: BatchUploadProgress) => void): Promise<BatchUploadResult> {
  return new Promise((resolve) => {
    const finish = () => {
      const jobs = getLiveUploads().filter((j) => ids.includes(j.id))
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const fileIds = ids.map((id) => {
        const j = byId.get(id)
        return j?.state === 'complete' ? j.objectId : null
      })
      const errors = ids.map((id) => byId.get(id)?.error ?? null)
      const failed = ids
        .map((id) => byId.get(id))
        .filter((j): j is LiveUploadItem => Boolean(j && (j.state === 'failed' || j.state === 'needs-file')))
        .map((j) => j.fileName)
      resolve({ failed, total: ids.length, fileIds, errors })
    }

    const check = () => {
      const jobs = ids.map((id) => getLiveUploads().find((j) => j.id === id)).filter(Boolean) as LiveUploadItem[]
      if (jobs.length === 0) return
      const uploaded = jobs.reduce((s, j) => s + j.uploadedBytes, 0)
      const totalBytes = jobs.reduce((s, j) => s + j.size, 0)
      const done = jobs.filter((j) => j.state === 'complete' || j.state === 'failed' || j.state === 'needs-file')
      const current = jobs.find((j) => j.state === 'uploading' || j.state === 'encrypting' || j.state === 'preparing') ?? jobs[0]
      onProgress({
        progress: totalBytes ? Math.round((uploaded / totalBytes) * 100) : 0,
        fileName: current?.fileName ?? null,
        batchIndex: Math.min(ids.length, done.length + 1),
        batchTotal: ids.length,
        etaText: current?.etaSeconds != null ? `~${current.etaSeconds}s left` : null,
        currentFileIndex: Math.min(ids.length, done.length + 1),
        currentFilePercent: current?.percent,
      })
      if (done.length === ids.length) {
        unsub()
        finish()
      }
    }

    const unsub = subscribeUploads(check)
    check()
  })
}

export async function uploadCoverAndSetAlbum(
  file: File,
  albumId: string,
  _userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
): Promise<{ fileId: string }> {
  refs.uploadStartMsRef.current = Date.now()
  refs.uploadTotalBytesRef.current = file.size
  const [jobId] = await enqueueFiles([file], { albumId, purpose: 'cover' })
  const result = await waitForJobs([jobId], onProgress)
  const fileId = result.fileIds[0]
  if (!fileId) throw new Error(result.errors[0] || 'Cover upload failed')
  const { error } = await supabase.from('albums').update({ cover_file_id: fileId }).eq('id', albumId)
  if (error) throw new Error(error.message)
  return { fileId }
}

export async function batchUploadFilesToAlbum(
  filesArray: File[],
  albumId: string,
  _userId: string,
  refs: Refs,
  onProgress: (p: BatchUploadProgress) => void,
  options?: { purpose?: FilePurpose },
): Promise<BatchUploadResult> {
  refs.uploadStartMsRef.current = Date.now()
  refs.uploadTotalBytesRef.current = filesArray.reduce((s, f) => s + f.size, 0)
  const ids = await enqueueFiles(filesArray, { albumId, purpose: options?.purpose ?? 'content' })
  return waitForJobs(ids, onProgress)
}
