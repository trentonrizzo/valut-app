import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import type { AlbumWithMeta } from '../types/album'
import { UploadQueueOverlay, type UploadQueueItem } from '../components/UploadQueueOverlay'
import { enqueueFiles, getLiveUploads, resumeJob, subscribeUploads, cancelJob, batchTotals } from '../lib/upload/manager'
import { formatBytes } from '../lib/formatBytes'

function toQueueItems(): UploadQueueItem[] {
  return getLiveUploads().map((j) => ({
    id: j.id,
    name: j.fileName,
    size: j.size,
    type: j.type,
    progress: j.percent,
    status:
      j.state === 'complete'
        ? 'done'
        : j.state === 'failed' || j.state === 'needs-file'
          ? 'failed'
          : j.state === 'queued' || j.state === 'paused'
            ? 'queued'
            : j.state === 'preparing' || j.state === 'encrypting'
              ? 'preparing'
              : 'uploading',
    error: j.error,
    speedText: j.speedBps > 0 ? `${formatBytes(j.speedBps)}/s` : null,
    etaText: j.etaSeconds != null ? (j.etaSeconds < 60 ? `~${j.etaSeconds}s left` : `~${Math.round(j.etaSeconds / 60)}m left`) : null,
    stateLabel: j.state,
  }))
}

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
    return toQueueItems()
  }, [tick])
  const totals = batchTotals(getLiveUploads())

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
              accept="image/*,video/*,*/*"
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
        etaText={totals.etaSeconds != null ? `~${totals.etaSeconds < 60 ? `${totals.etaSeconds}s` : `${Math.round(totals.etaSeconds / 60)}m`} left` : null}
        currentFileIndex={totals.completed}
        batchTotal={totals.total}
        currentFileName={items.find((i) => i.status === 'uploading' || i.status === 'preparing')?.name ?? null}
        currentFilePercent={items.find((i) => i.status === 'uploading')?.progress ?? null}
        onRetry={(id) => resumeJob(id)}
        onDismiss={() => {
          for (const it of items.filter((i) => i.status === 'failed')) void cancelJob(it.id)
        }}
      />
    </div>
  )
}
