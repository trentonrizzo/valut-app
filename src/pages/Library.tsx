import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'
import type { FileRow } from '../types/media'
import { listAllMatchingFileIds, listMediaPage } from '../lib/mediaQueries'
import { softDeleteFiles } from '../lib/trash'
import { setFilesLocked } from '../lib/locks'
import { classifyFileKind } from '../lib/fileKind'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { listTags, addTagsToFiles, removeTagsFromFiles } from '../lib/tags'
import { addFilesToAlbum, setFavorite, setRating } from '../lib/albumMembership'
import {
  attachFileForResume,
  batchTotals,
  cancelJob,
  cancelQueued,
  dismissCompleted,
  dismissFailed,
  enqueueFiles,
  getLiveUploads,
  pauseAll,
  pauseJob,
  resumeAll,
  resumeJob,
  retryAllFailed,
  retryJob,
  subscribeUploads,
} from '../lib/upload/manager'
import { liveToQueueItems } from '../lib/upload/queueUi'
import { formatEta } from '../lib/upload/strategy'
import { apiSignedGet } from '../lib/upload/storageApi'
import { FilterBar } from '../components/library/FilterBar'
import { BulkActionBar } from '../components/library/BulkActionBar'
import { TagPickerModal } from '../components/library/TagPickerModal'
import { VaultPhotoTileMedia } from '../components/files/VaultPhotoTile'
import { MediaDetailsSheet } from '../components/files/MediaDetailsSheet'
import { UploadQueueOverlay } from '../components/UploadQueueOverlay'
import { filesFromInput, logUploadSelection, selectionFailureReason } from '../lib/upload/selectFiles'
import { useMediaSelection } from '../context/SelectionContext'

export function Library() {
  const { user, session } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setSelectedFileIds } = useMediaSelection()
  const [filters, setFilters] = useState(() => {
    const tag = params.get('tag')
    const year = params.get('year')
    const type = params.get('type')
    const q = params.get('q') || params.get('search') || ''
    const domain = params.get('domain')
    const title = params.get('title')
    return {
      ...DEFAULT_MEDIA_FILTERS,
      favorite: params.get('favorite') === 'yes' ? ('yes' as const) : DEFAULT_MEDIA_FILTERS.favorite,
      type: type === 'photos' || type === 'videos' ? type : DEFAULT_MEDIA_FILTERS.type,
      tagIds: tag ? [tag] : [],
      search: q,
      domain: domain || null,
      resultTitle: title || null,
      capturedFrom: year && /^\d{4}$/.test(year) ? `${year}-01-01T00:00:00.000Z` : null,
      capturedTo: year && /^\d{4}$/.test(year) ? `${year}-12-31T23:59:59.999Z` : null,
    }
  })

  useEffect(() => {
    const tag = params.get('tag')
    const year = params.get('year')
    const type = params.get('type')
    const q = params.get('q') || params.get('search')
    const domain = params.get('domain')
    const title = params.get('title')
    const fav = params.get('favorite')
    setFilters((prev) => ({
      ...prev,
      // When URL explicitly sets favorite=yes (Favorites route), apply it.
      // When URL has no favorite param, clear a prior URL-driven favorites filter
      // so Library tab after Favorites does not stay stuck empty/filtered.
      favorite: fav === 'yes' ? 'yes' : fav === 'no' ? 'no' : 'all',
      ...(type === 'photos' || type === 'videos' ? { type } : type == null ? {} : { type: 'all' as const }),
      ...(tag ? { tagIds: tag.split(',').filter(Boolean) } : {}),
      ...(q != null ? { search: q } : {}),
      ...(domain != null ? { domain: domain || null } : {}),
      ...(title != null ? { resultTitle: title || null } : {}),
      ...(year && /^\d{4}$/.test(year)
        ? { capturedFrom: `${year}-01-01T00:00:00.000Z`, capturedTo: `${year}-12-31T23:59:59.999Z` }
        : {}),
    }))
  }, [params])

  const [detailsFile, setDetailsFile] = useState<FileRow | null>(null)
  const [rows, setRows] = useState<FileRow[]>([])
  const [cursor, setCursor] = useState<{ ts: string | null; id: string; num: number | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedFileIds([...selected])
  }, [selected, setSelectedFileIds])
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
    return liveToQueueItems(getLiveUploads())
  }, [queueTick])
  const queueTotals = batchTotals(getLiveUploads())
  const currentUpload = getLiveUploads().find((j) =>
    ['uploading', 'preparing', 'encrypting', 'finalizing', 'retrying'].includes(j.state),
  )

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
                <p className="dashboard__subtitle">
              All media · <a href="/deleted">Recently Deleted</a>
            </p>
          </div>
          <label className="btn btn--primary">
            Upload
            <input
              type="file"
              accept="image/*,video/*,.mp4,.mov,.m4v,.qt,video/mp4,video/quicktime,*/*"
              multiple
              className="visually-hidden"
              onChange={(e) => {
                const files = filesFromInput(e.currentTarget.files)
                e.currentTarget.value = ''
                const reason = selectionFailureReason(files)
                if (reason) {
                  showToast(reason, 'error')
                  alert(reason)
                  return
                }
                if (!user) {
                  showToast('Please sign in to upload.', 'error')
                  return
                }
                logUploadSelection('library-input-confirmed', {
                  count: files.length,
                  names: files.map((f) => f.name),
                  sizes: files.map((f) => f.size),
                })
                void enqueueFiles(files, { albumId: null }).catch((err) => {
                  const msg = err instanceof Error ? err.message : 'Upload failed'
                  showToast(msg, 'error')
                  alert(msg)
                })
              }}
            />
          </label>
        </div>
        <FilterBar filters={filters} onChange={setFilters} tags={tags} albums={albums} />
        <BulkActionBar
          count={selected.size}
          albums={albums}
          onClear={() => setSelected(new Set())}
          onSelectAll={() => setSelected(new Set(rows.map((r) => r.id)))}
          onSelectAllMatching={async () => {
            if (!user) return
            const ids = await listAllMatchingFileIds({ userId: user.id, filters })
            setSelected(new Set(ids))
            showToast(`Selected ${ids.length} matching items`)
          }}
          onAddToAlbum={async (albumId) => {
            if (!user) return
            await addFilesToAlbum(user.id, albumId, [...selected])
            showToast('Added to album')
          }}
          onDelete={async () => {
            if (!user || selected.size === 0) return
            if (!window.confirm(`Move ${selected.size} item(s) to Recently Deleted?`)) return
            await softDeleteFiles(user.id, [...selected])
            setRows((prev) => prev.filter((r) => !selected.has(r.id)))
            setSelected(new Set())
            showToast('Moved to Recently Deleted')
          }}
          onLock={async () => {
            if (!user) return
            await setFilesLocked(user.id, [...selected], true)
            setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, locked: true } : r)))
            showToast('Locked. Content stays hidden until you unlock with your Vault PIN this session.')
          }}
          onUnlock={async () => {
            if (!user) return
            await setFilesLocked(user.id, [...selected], false)
            setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, locked: false } : r)))
            showToast('Unlocked')
          }}
          onFavorite={async (on) => {
            if (!user) return
            try {
              await setFavorite(user.id, [...selected], on)
              setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, favorite: on } : r)))
              showToast(on ? `${selected.size} favorited` : `${selected.size} unfavorited`)
            } catch (e) {
              showToast(e instanceof Error ? e.message : 'Favorite failed', 'error')
            }
          }}
          onRate={async (rating) => {
            if (!user) return
            await setRating(user.id, [...selected], rating)
            setRows((prev) => prev.map((r) => (selected.has(r.id) ? { ...r, rating } : r)))
          }}
          onAddTags={() => setTagModal('add')}
          onRemoveTags={() => setTagModal('remove')}
          onDownload={() => void downloadSelected()}
          onDetails={() => {
            const id = [...selected][0]
            const row = rows.find((r) => r.id === id)
            if (row) setDetailsFile(row)
          }}
        />
        {loading && rows.length === 0 ? (
          <div className="vault-loading">Loading library…</div>
        ) : rows.length === 0 ? (
          <div className="vault-empty">
            {filters.favorite === 'yes' ? 'No favorites yet. Select media and tap Favorite.' : 'No media yet.'}
          </div>
        ) : (
          <ul className="vault-grid vault-grid--gallery">
            {rows.map((f) => {
              const kind = classifyFileKind({ name: f.file_name, mime_type: f.mime_type })
              return (
                <li
                  key={f.id}
                  className={`vault-photo-item ${selected.has(f.id) ? 'is-selected' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    const next = new Set(selected)
                    if (next.has(f.id)) next.delete(f.id)
                    else next.add(f.id)
                    setSelected(next)
                  }}
                >
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
                      {f.locked ? (
                        <div className="file-kind-tile">Locked</div>
                      ) : user && (kind === 'image' || kind === 'video') ? (
                        <VaultPhotoTileMedia file={f} userId={user.id} />
                      ) : (
                        <div className="file-kind-tile">{kind.toUpperCase()}</div>
                      )}
                    </div>
                    {kind === 'video' ? <span className="vault-photo-tile__video-glyph" aria-hidden /> : null}
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
          const ids = [...selected]
          try {
            if (tagModal === 'add') {
              await addTagsToFiles(user.id, ids, tagIds)
              showToast(`${ids.length} item(s) tagged`)
            } else {
              await removeTagsFromFiles(user.id, ids, tagIds)
              showToast(`Tags removed from ${ids.length} item(s)`)
            }
            setTagModal(null)
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Tag update failed', 'error')
          }
        }}
      />
      <UploadQueueOverlay
        visible={queueItems.some((i) => i.status !== 'done')}
        items={queueItems}
        overallProgress={queueTotals.percent}
        etaText={formatEta(queueTotals.etaSeconds)}
        currentFileIndex={queueTotals.completed + (currentUpload ? 1 : 0)}
        batchTotal={queueTotals.total}
        currentFileName={currentUpload?.fileName ?? null}
        currentFilePercent={currentUpload ? queueItems.find((i) => i.id === currentUpload.id)?.progress ?? null : null}
        onRetry={retryJob}
        onRetryAll={retryAllFailed}
        onPause={pauseJob}
        onResume={resumeJob}
        onCancel={(id) => void cancelJob(id)}
        onReselect={attachFileForResume}
        onDismiss={dismissFailed}
        onPauseAll={pauseAll}
        onResumeAll={resumeAll}
        onCancelQueued={cancelQueued}
        onDismissCompleted={dismissCompleted}
      />
      <MediaDetailsSheet
        file={detailsFile}
        onClose={() => setDetailsFile(null)}
        onChanged={() => {
          void load(true)
        }}
      />
    </div>
  )
}
