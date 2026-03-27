import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { batchUploadFilesToAlbum } from '../lib/batchUploadToAlbum'
import type { AlbumWithMeta } from '../types/album'
import { UploadProgressOverlay } from '../components/UploadProgressOverlay'

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
  const uploadStartMsRef = useRef(0)
  const uploadTotalBytesRef = useRef(0)

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

  async function runUpload(filesArray: File[]) {
    if (!user || !albumId) {
      showToast('Choose an album first.', 'error')
      return
    }
    if (filesArray.length === 0) return

    setUploading(true)
    setUploadProgress(0)
    setUploadFileName(filesArray[0].name)
    setUploadBatchTotal(filesArray.length)
    setUploadBatchIndex(1)
    setUploadEtaText(null)

    try {
      const { failed, total } = await batchUploadFilesToAlbum(
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
        },
      )

      await refreshAlbums()

      if (failed.length === 0) {
        showToast(total === 1 ? 'Upload complete' : `Uploaded ${total} files`)
      } else if (failed.length === total) {
        showToast('All uploads failed', 'error')
      } else {
        showToast(
          `Uploaded ${total - failed.length} of ${total} files. Failed: ${failed.join(', ')}`,
          'error',
        )
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error')
      console.error(e)
    } finally {
      setUploading(false)
      setUploadProgress(0)
      setUploadFileName(null)
      setUploadBatchIndex(0)
      setUploadBatchTotal(0)
      setUploadEtaText(null)
    }
  }

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
              disabled={uploading}
            >
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="upload-page__drop btn btn--primary btn--block">
            Choose files
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={uploading || !albumId}
              onChange={(e) => {
                const list = e.target.files
                if (list && list.length > 0) {
                  void runUpload(Array.from(list))
                }
                e.currentTarget.value = ''
              }}
            />
          </label>
          <p className="upload-page__hint">Images and videos · multiple files supported</p>
        </div>
      )}

      <UploadProgressOverlay
        uploading={uploading}
        uploadProgress={uploadProgress}
        uploadFileName={uploadFileName}
        uploadBatchIndex={uploadBatchIndex}
        uploadBatchTotal={uploadBatchTotal}
        uploadEtaText={uploadEtaText}
      />
    </div>
  )
}
