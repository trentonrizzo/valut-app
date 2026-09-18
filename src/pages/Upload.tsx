import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import type { AlbumWithMeta } from '../types/album'
import { UploadQueueOverlay } from '../components/UploadQueueOverlay'
import {
  attachFileForResume,
  batchTotals,
  cancelJob,
  dismissFailed,
  enqueueFiles,
  getLiveUploads,
  pauseJob,
  resumeJob,
  retryAllFailed,
  retryJob,
  subscribeUploads,
} from '../lib/upload/manager'
import { liveToQueueItems } from '../lib/upload/queueUi'
import { formatEta, formatSpeedBps } from '../lib/upload/strategy'

export function Upload() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [albums, setAlbums] = useState<AlbumWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [albumId, setAlbumId] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeUploads(() => setTick((n) => n + 1)), [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void fetchAlbumsWithCounts(user.id).then((r) => {
      if (cancelled) return
      const list = r.data ?? []
      setAlbums(list)
      if (list[0]) setAlbumId((prev) => prev || list[0].id)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  const items = useMemo(() => {
    void tick
    return liveToQueueItems(getLiveUploads())
  }, [tick])
  const totals = batchTotals(getLiveUploads())
  const current = getLiveUploads().find((j) =>
    ['uploading', 'preparing', 'encrypting', 'finalizing', 'retrying'].includes(j.state),
  )

  const start = useCallback(
    (files: File[]) => {
      if (!user) return
      if (!albumId) {
        showToast('Choose an album first.', 'error')
        return
      }
      void enqueueFiles(files, { albumId }).catch((e) => showToast(e instanceof Error ? e.message : 'Upload failed', 'error'))
    },
    [user, albumId, showToast],
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
          <p>Create an album from the Albums tab first, or upload from Library without an album.</p>
        </div>
      ) : (
        <div className="upload-page__body">
          <label className="field">
            <span className="field-label">Album</span>
            <select className="field-input" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
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
              accept="image/*,video/*,.mp4,.mov,.m4v,.qt,video/mp4,video/quicktime,*/*"
              multiple
              disabled={!albumId}
              onChange={(e) => {
                const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                e.currentTarget.value = ''
                if (files.length) start(files)
              }}
            />
          </label>
          <p className="upload-page__hint">Images, videos, and other files · multipart for large videos · no 200MB cap</p>
        </div>
      )}
      <UploadQueueOverlay
        visible={items.length > 0 && items.some((i) => i.status !== 'done')}
        items={items}
        overallProgress={totals.percent}
        etaText={totals.etaSeconds != null ? formatEta(totals.etaSeconds) : totals.speed ? formatSpeedBps(totals.speed) : null}
        currentFileIndex={totals.completed + (current ? 1 : 0)}
        batchTotal={totals.total}
        currentFileName={current?.fileName ?? null}
        currentFilePercent={current ? items.find((i) => i.id === current.id)?.progress ?? null : null}
        onRetry={retryJob}
        onRetryAll={retryAllFailed}
        onPause={pauseJob}
        onResume={resumeJob}
        onCancel={(id) => void cancelJob(id)}
        onReselect={attachFileForResume}
        onDismiss={dismissFailed}
      />
    </div>
  )
}
