import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { DEFAULT_MEDIA_FILTERS, type MediaFilters } from '../types/media'
import type { FileRow } from '../types/media'
import { listMediaPage } from '../lib/mediaQueries'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { listTags, addTagsToFiles, removeTagsFromFiles } from '../lib/tags'
import { addFilesToAlbum, setFavorite } from '../lib/albumMembership'
import { enqueueFiles, getLiveUploads, subscribeUploads } from '../lib/upload/manager'
import { apiSignedGet } from '../lib/upload/storageApi'
import { FilterBar } from '../components/library/FilterBar'
import { BulkActionBar } from '../components/library/BulkActionBar'
import { TagPickerModal } from '../components/library/TagPickerModal'
import { VaultPhotoTileMedia } from '../components/files/VaultPhotoTile'
import { isVideoFileName } from '../lib/mediaTypes'
import { UploadQueueOverlay, type UploadQueueItem } from '../components/UploadQueueOverlay'
import { formatBytes } from '../lib/formatBytes'

function mapQueue(items: ReturnType<typeof getLiveUploads>): UploadQueueItem[] {
  return items.map((j) => ({
    id: j.id,
    name: j.fileName,
    size: j.size,
    type: j.type,
    progress: j.percent,
    status: j.state === 'complete' ? 'done' : j.state === 'failed' || j.state === 'needs-file' ? 'failed' : j.state === 'paused' ? 'queued' : 'uploading',
    error: j.error,
    speedText: j.speedBps > 0 ? `${formatBytes(j.speedBps)}/s` : null,
    etaText: j.etaSeconds != null ? (j.etaSeconds < 60 ? `~${j.etaSeconds}s` : `~${Math.round(j.etaSeconds / 60)}m`) : null,
    stateLabel: j.state,
  }))
}

export function Library() {
  const { user, session } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [filters, setFilters] = useState(DEFAULT_MEDIA_FILTERS)
  const [rows, setRows] = useState<FileRow[]>([])
  const [cursor, setCursor] = useState<{ ts: string | null; id: string; num: number | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([])
  const [tagModal, setTagModal] = useState<'add' | 'remove' | null>(null)
  const [queueTick, setQueueTick] = useState(0)

  useEffect(() => subscribeUploads(() => setQueueTick((n) => n + 1)), [])

  const load = useCallback(
    async (reset: boolean) => {
      if (!user) return
      setLoading(true)
      try {
        const page = await listMediaPage({
          userId: user.id,
          filters,
          cursor: reset ? null : cursor,
        })
        setRows((prev) => (reset ? page.rows : [...prev, ...page.rows]))
        setCursor(page.nextCursor)
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not load library', 'error')
      } finally {
        setLoading(false)
      }
    },
    [user, filters, cursor, showToast],
  )

  useEffect(() => {
    setCursor(null)
    setRows([])
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when filters change
  }, [filters, user?.id])

  useEffect(() => {
    if (!user) return
    void listTags(user.id).then(setTags).catch(() => {})
    void fetchAlbumsWithCounts(user.id).then((r) => {
      if (r.data) setAlbums(r.data.map((a) => ({ id: a.id, name: a.name })))
    })
  }, [user])

  const queueItems = useMemo(() => {
    void queueTick
    return mapQueue(getLiveUploads())
  }, [queueTick])

  async function downloadSelected() {
    const token = session?.access_token
    if (!token) return
    for (const id of selected) {
      try {
        const r = await apiSignedGet(token, id, 'original')
        const a = document.createElement('a')
        a.href = r.url
        a.download = rows.find((x) => x.id === id)?.file_name || 'download'
        a.rel = 'noopener'
        a.click()
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Download failed', 'error')
      }
    }
  }

  return (
    <div className="dashboard">
      <main className="dashboard__main">
        <div className="dashboard__toolbar">
          <div>
            <h1 className="dashboard__title">Library</h1>
            <p className="dashboard__subtitle">All media · albums are organizational only</p>
          </div>
          <label className="btn btn--primary">
            Upload
            <input
              type="file"
              accept="image/*,video/*,*/*"
              multiple
              className="visually-hidden"
              onChange={(e) => {
                const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                e.currentTarget.value = ''
                if (files.length && user) void enqueueFiles(files, { albumId: null })
              }}
            />
          </label>
        </div>
        <FilterBar filters={filters} onChange={setFilters} tags={tags} />
        <BulkActionBar
          count={selected.size}
          albums={albums}
          onClear={() => setSelected(new Set())}
          onSelectAll={() => setSelected(new Set(rows.map((r) => r.id)))}
          onAddToAlbum={async (albumId) => {
            if (!user) return
            await addFilesToAlbum(user.id, albumId, [...selected])
            showToast('Added to album')
          }}
          onFavorite={async (on) => {
            if (!user) return
            await setFavorite(user.id, [...selected], on)
            setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, favorite: on } : r)))
          }}
          onAddTags={() => setTagModal('add')}
          onRemoveTags={() => setTagModal('remove')}
          onDownload={() => void downloadSelected()}
        />
        {loading && rows.length === 0 ? (
          <div className="vault-loading">Loading library…</div>
        ) : rows.length === 0 ? (
          <div className="vault-empty">No media yet.</div>
        ) : (
          <ul className="vault-grid vault-grid--gallery">
            {rows.map((f) => {
              const isVideo = isVideoFileName(f.file_name) || Boolean(f.mime_type?.startsWith('video/'))
              return (
                <li key={f.id} className={`vault-photo-item ${selected.has(f.id) ? 'is-selected' : ''}`}>
                  <label className="vault-photo-item__check">
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => {
                        const next = new Set(selected)
                        if (next.has(f.id)) next.delete(f.id)
                        else next.add(f.id)
                        setSelected(next)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="vault-photo-tile"
                    onClick={() => navigate(`/library/media/${f.id}`, { state: { filters } })}
                  >
                    <div className="vault-photo-tile__media">
                      {user ? <VaultPhotoTileMedia file={f} userId={user.id} /> : null}
                    </div>
                    {isVideo ? <span className="vault-photo-tile__video-glyph" aria-hidden>▶</span> : null}
                    {f.favorite ? <span className="vault-photo-tile__fav">★</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {cursor ? (
          <div className="library-more">
            <button type="button" className="btn btn--outline" onClick={() => void load(false)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </main>
      <TagPickerModal
        open={tagModal !== null}
        userId={user?.id ?? ''}
        mode={tagModal ?? 'add'}
        onClose={() => setTagModal(null)}
        onApply={async (tagIds) => {
          if (!user) return
          if (tagModal === 'add') await addTagsToFiles(user.id, [...selected], tagIds)
          else await removeTagsFromFiles(user.id, [...selected], tagIds)
          setTagModal(null)
          showToast('Tags updated')
        }}
      />
      <UploadQueueOverlay
        visible={queueItems.some((i) => i.status !== 'done')}
        items={queueItems}
        overallProgress={0}
        etaText={null}
        currentFileIndex={1}
        batchTotal={queueItems.length}
        currentFileName={queueItems.find((i) => i.status === 'uploading')?.name ?? null}
        currentFilePercent={queueItems.find((i) => i.status === 'uploading')?.progress ?? null}
        onRetry={() => {}}
        onDismiss={() => {}}
      />
    </div>
  )
}
