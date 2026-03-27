import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { batchUploadFilesToAlbum, validateUploadFileSizes } from '../lib/batchUploadToAlbum'
import type { AlbumWithMeta } from '../types/album'
import { UploadQueueOverlay, type UploadQueueItem } from '../components/UploadQueueOverlay'

export function Upload() {
  const { user } = useAuth()
  const { showToast } = useToast()

  const [albums, setAlbums] = useState<AlbumWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [albumId, setAlbumId] = useState<string>('')

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)
  const [uploadBatchIndex, setUploadBatchIndex] = useState(0)
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0)
  const [uploadEtaText, setUploadEtaText] = useState<string | null>(null)
  const [uploadCurrentFilePercent, setUploadCurrentFilePercent] = useState<number | null>(null)
  const uploadStartMsRef = useRef(0)
  const uploadTotalBytesRef = useRef(0)
  const uploadLockRef = useRef(false)
  const fileByQueueIdRef = useRef<Map<string, File>>(new Map())

  const [uploadQueueItems, setUploadQueueItems] = useState<UploadQueueItem[]>([])
  const [isAdding, setIsAdding] = useState(false)

  const refreshAlbums = useCallback(async () => {
    if (!user) return
    const { data, error } = await fetchAlbumsWithCounts(user.id)
    if (error) {
      setAlbums([])
      return
    }
    setAlbums(data ?? [])
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await fetchAlbumsWithCounts(user.id)
      if (cancelled) return
      if (error) {
        setAlbums([])
      } else {
        const list = data ?? []
        setAlbums(list)
        if (list.length > 0) {
          setAlbumId((prev) => prev || list[0].id)
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const finishUploadUi = useCallback(() => {
    uploadLockRef.current = false
    setUploading(false)
    setUploadProgress(0)
    setUploadFileName(null)
    setUploadBatchIndex(0)
    setUploadBatchTotal(0)
    setUploadEtaText(null)
    setUploadCurrentFilePercent(null)
  }, [])

  const runUpload = useCallback(
    async (filesArray: File[], queueIds: string[]) => {
      if (!user || !albumId) {
        showToast('Choose an album first.', 'error')
        finishUploadUi()
        return
      }
      if (filesArray.length === 0) return

      let fileIds: (string | null)[]
      let failed: string[]
      let total: number
      let errors: (string | null)[]

      try {
        const r = await batchUploadFilesToAlbum(
          filesArray,
          albumId,
          user.id,
          { uploadStartMsRef, uploadTotalBytesRef },
          (p) => {
            setUploadProgress(p.progress)
            setUploadFileName(p.fileName)
            setUploadBatchIndex(p.batchIndex)
            setUploadBatchTotal(p.batchTotal)
            setUploadEtaText(p.etaText)
            if (p.currentFilePercent != null) setUploadCurrentFilePercent(p.currentFilePercent)
            const idx = p.currentFileIndex - 1
            if (idx >= 0 && idx < queueIds.length) {
              const targetId = queueIds[idx]!
              setUploadQueueItems((prev) =>
                prev.map((item) =>
                  item.id === targetId
                    ? {
                        ...item,
                        progress: p.currentFilePercent ?? item.progress,
                        name: p.fileName ?? item.name,
                        status:
                          item.status === 'queued'
                            ? 'uploading'
                            : item.status === 'preparing'
                              ? 'uploading'
                              : item.status,
                      }
                    : item,
                ),
              )
            }
          },
          {
            onFilePhase: (fileIndex, phase) => {
              const targetId = queueIds[fileIndex]
              if (!targetId) return
              setUploadQueueItems((prev) =>
                prev.map((item) => {
                  if (item.id !== targetId) return item
                  if (phase === 'preparing') return { ...item, status: 'preparing' }
                  return { ...item, status: 'uploading', progress: Math.max(item.progress, 12) }
                }),
              )
            },
          },
        )
        fileIds = r.fileIds
        failed = r.failed
        total = r.total
        errors = r.errors
      } catch (e) {
        console.error(e)
        const msg = e instanceof Error ? e.message : 'Upload failed'
        queueIds.forEach((qid) => fileByQueueIdRef.current.delete(qid))
        setUploadQueueItems((prev) =>
          prev.map((item) =>
            queueIds.includes(item.id) ? { ...item, status: 'failed', error: msg } : item,
          ),
        )
        showToast(msg, 'error')
        finishUploadUi()
        return
      }

      setUploadQueueItems((prev) =>
        prev.map((item) => {
          const i = queueIds.indexOf(item.id)
          if (i === -1) return item
          if (fileIds[i]) return { ...item, status: 'done', progress: 100, error: null }
          return {
            ...item,
            status: 'failed',
            progress: item.progress,
            error: errors[i] ?? 'Upload failed',
          }
        }),
      )

      queueIds.forEach((qid, i) => {
        if (fileIds[i]) fileByQueueIdRef.current.delete(qid)
      })

      await refreshAlbums()

      if (failed.length === 0) {
        showToast(total === 1 ? 'Upload complete' : `Uploaded ${total} files`)
        setTimeout(() => {
          setUploadQueueItems((prev) => prev.filter((it) => !queueIds.includes(it.id)))
        }, 400)
      } else if (failed.length === total) {
        showToast('All uploads failed', 'error')
      } else {
        showToast(
          `Uploaded ${total - failed.length} of ${total} files. Failed: ${failed.join(', ')}`,
          'error',
        )
      }

      finishUploadUi()
    },
    [user, albumId, showToast, refreshAlbums, finishUploadUi],
  )

  const dismissFailedUploadQueue = useCallback(() => {
    setUploadQueueItems((prev) => {
      const failed = prev.filter((i) => i.status === 'failed')
      for (const item of failed) {
        fileByQueueIdRef.current.delete(item.id)
      }
      return []
    })
  }, [])

  const retryUploadQueueItem = useCallback(
    (queueId: string) => {
      const file = fileByQueueIdRef.current.get(queueId)
      if (!file || !user || !albumId) return
      setUploadQueueItems((prev) =>
        prev.map((it) =>
          it.id === queueId ? { ...it, status: 'queued', progress: 0, error: null } : it,
        ),
      )
      setUploading(true)
      uploadLockRef.current = true
      setUploadProgress(0)
      setUploadFileName(file.name)
      setUploadBatchTotal(1)
      setUploadBatchIndex(1)
      setUploadEtaText(null)
      setUploadCurrentFilePercent(0)
      requestAnimationFrame(() => {
        setTimeout(() => {
          void runUpload([file], [queueId])
        }, 0)
      })
    },
    [user, albumId, runUpload],
  )

  return (
    <div className="upload-page">
      <header className="upload-page__header">
        <h1 className="upload-page__title">Upload</h1>
        <p className="upload-page__subtitle">Add photos and videos to an album</p>
      </header>

      {loading ? (
        <div className="upload-page__loading">Loading albums…</div>
      ) : albums.length === 0 ? (
        <div className="upload-page__empty">
          <p>Create an album from the Albums tab first.</p>
        </div>
      ) : (
        <div className="upload-page__body">
          <label className="field">
            <span className="field-label">Album</span>
            <select
              className="field-input"
              value={albumId}
              onChange={(e) => setAlbumId(e.target.value)}
              disabled={uploading || isAdding}
            >
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="upload-page__drop btn btn--primary btn--block" aria-disabled={isAdding || uploading || !albumId}>
            Choose files
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={isAdding || uploading || !albumId}
              onChange={(e) => {
                const list = e.target.files
                e.currentTarget.value = ''
                if (!list || list.length === 0) return
                const filesArray = Array.from(list)
                if (isAdding || uploadLockRef.current) return
                if (!user || !albumId) {
                  showToast('Choose an album first.', 'error')
                  return
                }
                if (!validateUploadFileSizes(filesArray)) return

                setIsAdding(true)
                setTimeout(() => setIsAdding(false), 500)

                const queueIds = filesArray.map(() => crypto.randomUUID())
                queueIds.forEach((id, i) => fileByQueueIdRef.current.set(id, filesArray[i]!))

                const queueItems: UploadQueueItem[] = queueIds.map((id, i) => ({
                  id,
                  name: filesArray[i]!.name,
                  size: filesArray[i]!.size,
                  type: filesArray[i]!.type || 'application/octet-stream',
                  progress: 0,
                  status: 'queued',
                  error: null,
                }))

                setUploadQueueItems((prev) => [...queueItems, ...prev])
                setUploading(true)
                setUploadProgress(0)
                setUploadFileName(filesArray[0]!.name)
                setUploadBatchTotal(filesArray.length)
                setUploadBatchIndex(1)
                setUploadEtaText(null)
                setUploadCurrentFilePercent(0)

                uploadLockRef.current = true
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    void runUpload(filesArray, queueIds)
                  }, 0)
                })
              }}
            />
          </label>
          <p className="upload-page__hint">Images and videos · multiple files supported</p>
        </div>
      )}

      <UploadQueueOverlay
        visible={
          uploading ||
          uploadQueueItems.some((i) =>
            ['queued', 'preparing', 'uploading', 'failed'].includes(i.status),
          )
        }
        items={uploadQueueItems}
        overallProgress={uploadProgress}
        etaText={uploadEtaText}
        currentFileIndex={uploadBatchIndex}
        batchTotal={uploadBatchTotal}
        currentFileName={uploadFileName}
        currentFilePercent={uploadCurrentFilePercent}
        onRetry={retryUploadQueueItem}
        onDismiss={dismissFailedUploadQueue}
      />
    </div>
  )
}
