import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { buildAlbumsWithMeta, fetchAlbumsWithCounts } from '../lib/albumQueries'
import { formatBytes } from '../lib/formatBytes'
import { isVideoFileName } from '../lib/mediaTypes'
import type { AlbumRow, AlbumWithMeta } from '../types/album'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'
import { RenameAlbumModal } from '../components/albums/RenameAlbumModal'
import { ConfirmDeleteAlbumModal } from '../components/albums/ConfirmDeleteAlbumModal'
import { AlbumCoverPickerModal } from '../components/albums/AlbumCoverPickerModal'
import { MediaViewer } from '../components/files/MediaViewer'
import { UploadProgressOverlay } from '../components/UploadProgressOverlay'
import { batchUploadFilesToAlbum } from '../lib/batchUploadToAlbum'

const GALLERY_COLS_KEY = 'vault-gallery-grid-cols'
type GalleryCols = 1 | 2 | 3 | 4 | 5

function loadGalleryCols(): GalleryCols {
  try {
    const raw = localStorage.getItem(GALLERY_COLS_KEY)
    const n = raw ? parseInt(raw, 10) : 3
    if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n
  } catch {
    /* ignore */
  }
  return 3
}

function GridColsIcon({ cols }: { cols: number }) {
  const g = 20 / cols
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="vault-grid-cols__icon">
      {Array.from({ length: cols }).map((_, i) => (
        <rect
          key={i}
          x={i * g + 0.6}
          y={2}
          width={g - 1.2}
          height={16}
          rx="1.2"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const { showToast } = useToast()

  const [albums, setAlbums] = useState<AlbumWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AlbumWithMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AlbumWithMeta | null>(null)
  const [coverPickerAlbum, setCoverPickerAlbum] = useState<AlbumWithMeta | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [creatingAlbum, setCreatingAlbum] = useState(false)

  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)
  type FileRow = {
    id: string
    user_id: string
    album_id: string
    file_name: string
    file_url: string
    created_at: string
    file_size_bytes?: number | null
  }

  const [files, setFiles] = useState<FileRow[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)
  const [uploadBatchIndex, setUploadBatchIndex] = useState(0)
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0)
  const [uploadEtaText, setUploadEtaText] = useState<string | null>(null)
  const uploadStartMsRef = useRef(0)
  const uploadTotalBytesRef = useRef(0)

  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewerFileId, setViewerFileId] = useState<string | null>(null)

  const [fileActionTarget, setFileActionTarget] = useState<FileRow | null>(null)
  const [fileInfoTarget, setFileInfoTarget] = useState<FileRow | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTouchStartRef = useRef<{ x: number; y: number } | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressTouchStartRef.current = null
  }, [])

  const [columns, setColumns] = useState(3)

  type FileSort =
    | 'newest'
    | 'oldest'
    | 'largest'
    | 'smallest'
    | 'images_first'
    | 'videos_first'
  const [fileSort, setFileSort] = useState<FileSort>('newest')
  const [galleryCols, setGalleryCols] = useState<GalleryCols>(loadGalleryCols)

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_COLS_KEY, String(galleryCols))
    } catch {
      /* ignore */
    }
  }, [galleryCols])

  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const refreshAlbums = useCallback(async () => {
    if (!user) return

    const { data, error } = await fetchAlbumsWithCounts(user.id)
    if (error) {
      setFetchError(error)
      setAlbums([])
      return
    }

    setFetchError(null)
    setAlbums(data ?? [])
  }, [user])

  const persistAlbumOrder = useCallback(
    async (reordered: AlbumWithMeta[]) => {
      if (!user) return
      const rows = reordered
        .map((album, index) => ({ id: album.id, order_index: index }))
        .filter((row) => !String(row.id).startsWith('optimistic-'))
      if (rows.length === 0) return
      for (const row of rows) {
        const { error } = await supabase
          .from('albums')
          .update({ order_index: row.order_index })
          .eq('id', row.id)
          .eq('user_id', user.id)
        if (error) {
          showToast(error.message, 'error')
          break
        }
      }
    },
    [showToast, user],
  )

  const handleAlbumReorder = useCallback(
    (next: AlbumWithMeta[]) => {
      const withIndex = next.map((a, i) => ({ ...a, order_index: i }))
      setAlbums(withIndex)
      void persistAlbumOrder(withIndex)
    },
    [persistAlbumOrder],
  )

  const openAlbum = useMemo(() => {
    if (!openAlbumId) return null
    return albums.find((a) => a.id === openAlbumId) ?? null
  }, [albums, openAlbumId])

  const displayFiles = useMemo(() => {
    const list = [...files]
    const byDateDesc = (a: FileRow, b: FileRow) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    const byDateAsc = (a: FileRow, b: FileRow) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()

    switch (fileSort) {
      case 'newest':
        return list.sort(byDateDesc)
      case 'oldest':
        return list.sort(byDateAsc)
      case 'largest':
        return list.sort((a, b) => {
          const sa = a.file_size_bytes
          const sb = b.file_size_bytes
          if (sa == null && sb == null) return byDateDesc(a, b)
          if (sa == null) return 1
          if (sb == null) return -1
          if (sb !== sa) return sb - sa
          return byDateDesc(a, b)
        })
      case 'smallest':
        return list.sort((a, b) => {
          const sa = a.file_size_bytes
          const sb = b.file_size_bytes
          if (sa == null && sb == null) return byDateDesc(a, b)
          if (sa == null) return 1
          if (sb == null) return -1
          if (sa !== sb) return sa - sb
          return byDateDesc(a, b)
        })
      case 'images_first':
        return list.sort((a, b) => {
          const va = isVideoFileName(a.file_name)
          const vb = isVideoFileName(b.file_name)
          if (va !== vb) return va ? 1 : -1
          return byDateDesc(a, b)
        })
      case 'videos_first':
        return list.sort((a, b) => {
          const va = isVideoFileName(a.file_name)
          const vb = isVideoFileName(b.file_name)
          if (va !== vb) return va ? -1 : 1
          return byDateDesc(a, b)
        })
      default:
        return list.sort(byDateDesc)
    }
  }, [files, fileSort])

  const mediaFiles = useMemo(
    () =>
      displayFiles.map((f) => ({
        id: f.id,
        file_url: f.file_url,
        file_name: f.file_name,
        created_at: f.created_at,
        file_size_bytes: f.file_size_bytes,
      })),
    [displayFiles],
  )

  useEffect(() => {
    setViewerOpen(false)
    setViewerIndex(0)
    setViewerFileId(null)
    setFileSort('newest')
  }, [openAlbumId])

  useEffect(() => {
    if (!viewerOpen || !viewerFileId) return
    const ni = displayFiles.findIndex((f) => f.id === viewerFileId)
    if (ni >= 0) setViewerIndex(ni)
  }, [displayFiles, viewerOpen, viewerFileId])

  useEffect(() => {
    if (!viewerOpen) return
    setViewerIndex((prev) => {
      const max = Math.max(0, mediaFiles.length - 1)
      return Math.max(0, Math.min(prev, max))
    })
  }, [viewerOpen, mediaFiles.length])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    ;(async () => {
      const { data, error } = await fetchAlbumsWithCounts(user.id)
      if (cancelled) return

      if (error) {
        setFetchError(error)
        setAlbums([])
      } else {
        const list = data ?? []
        setFetchError(null)
        setAlbums(list)
      }

      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user || !openAlbumId) {
      setFiles([])
      return
    }

    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('files')
          .select('*')
          .eq('album_id', openAlbumId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (error) throw new Error(error.message)
        if (!cancelled) setFiles((data as FileRow[]) ?? [])
      } catch (e) {
        if (cancelled) return
        setFiles([])
        setFilesError(e instanceof Error ? e.message : 'Could not load files')
      } finally {
        if (!cancelled) setFilesLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, openAlbumId])

  async function handleCreateAlbum(name: string) {
    if (!user) throw new Error('Not signed in.')

    const tempId = `optimistic-${crypto.randomUUID()}`
    const maxOrder = albums.reduce((m, a) => Math.max(m, a.order_index ?? 0), -1)
    const nextOrder = maxOrder + 1
    const optimistic: AlbumWithMeta = {
      id: tempId,
      user_id: user.id,
      name,
      created_at: new Date().toISOString(),
      itemCount: 0,
      totalBytes: 0,
      previewUrl: null,
      previewIsVideo: false,
      order_index: nextOrder,
      cover_file_id: null,
    }

    setAlbums((prev) => [...prev, optimistic])
    setCreatingAlbum(true)

    try {
      const { data, error } = await supabase
        .from('albums')
        .insert({ user_id: user.id, name, order_index: nextOrder })
        .select()
        .single()

      if (error) throw new Error(error.message)

      const real = buildAlbumsWithMeta([data as AlbumRow], [])[0]
      setAlbums((prev) => prev.map((a) => (a.id === tempId ? real : a)))
      setOpenAlbumId(real.id)
      showToast('Album created')
    } catch (e) {
      setAlbums((prev) => prev.filter((a) => a.id !== tempId))
      const msg = e instanceof Error ? e.message : 'Could not create album'
      showToast(msg, 'error')
      throw e instanceof Error ? e : new Error(msg)
    } finally {
      setCreatingAlbum(false)
    }
  }

  async function handleRename(newName: string) {
    if (!renameTarget || !user) return

    const id = renameTarget.id
    const prevName = renameTarget.name

    setBusy(id, true)
    setAlbums((prev) => prev.map((a) => (a.id === id ? { ...a, name: newName } : a)))

    try {
      const { error } = await supabase
        .from('albums')
        .update({ name: newName })
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw new Error(error.message)
      showToast('Album renamed')
    } catch (e) {
      setAlbums((prev) => prev.map((a) => (a.id === id ? { ...a, name: prevName } : a)))
      const msg = e instanceof Error ? e.message : 'Could not rename album'
      showToast(msg, 'error')
      throw e instanceof Error ? e : new Error(msg)
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || !user) return

    const removed = deleteTarget
    const id = removed.id

    try {
      const { error } = await supabase.from('albums').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw new Error(error.message)
      setAlbums((prev) => prev.filter((a) => a.id !== id))
      if (openAlbumId === id) setOpenAlbumId(null)
      setDeleteTarget(null)
      showToast('Album deleted')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete album', 'error')
    }
  }

  async function handleRemoveAlbumCover(album: AlbumWithMeta) {
    if (!user) return
    setBusy(album.id, true)
    try {
      const { error } = await supabase
        .from('albums')
        .update({ cover_file_id: null })
        .eq('id', album.id)
        .eq('user_id', user.id)
      if (error) throw new Error(error.message)
      await refreshAlbums()
      showToast('Cover removed')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove cover', 'error')
    } finally {
      setBusy(album.id, false)
    }
  }

  const albumCountLabel =
    albums.length === 0 ? 'No albums' : albums.length === 1 ? '1 album' : `${albums.length} albums`

  return (
    <div className="dashboard">
      <main className="dashboard__main">
        {!openAlbum ? (
          <>
            <div className="dashboard__toolbar">
              <div>
                <h1 className="dashboard__title">Albums</h1>
                <p className="dashboard__subtitle">
                  {loading ? 'Loading…' : albumCountLabel} · Tap an album to open it
                </p>
              </div>
              <div className="dashboard__toolbar-actions">
                <div className="vault-grid-cols" role="toolbar" aria-label="Album grid columns">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`vault-grid-cols__btn ${columns === n ? 'is-active' : ''}`}
                      onClick={() => setColumns(n)}
                      aria-pressed={columns === n}
                      title={`${n} column${n === 1 ? '' : 's'}`}
                    >
                      <GridColsIcon cols={n} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreateModalOpen(true)}
                  disabled={loading || creatingAlbum}
                >
                  {creatingAlbum ? 'Creating…' : 'Create album'}
                </button>
              </div>
            </div>

            {fetchError ? (
              <div className="banner banner--error" role="alert">
                <strong>Could not load albums.</strong> {fetchError}
              </div>
            ) : null}

            {loading ? (
              <div className="album-skeleton-grid" aria-busy="true" aria-label="Loading albums">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="album-skeleton-card" />
                ))}
              </div>
            ) : (
              <AlbumGrid
                albums={albums}
                columns={columns}
                busyAlbumIds={busyIds}
                activeAlbumId={openAlbumId}
                onOpen={(album) => setOpenAlbumId(album.id)}
                onRename={(a) => setRenameTarget(a)}
                onDelete={(a) => setDeleteTarget(a)}
                onSetCover={(a) => setCoverPickerAlbum(a)}
                onRemoveCover={(a) => void handleRemoveAlbumCover(a)}
                onCreateClick={() => setCreateModalOpen(true)}
                onReorder={handleAlbumReorder}
              />
            )}
          </>
        ) : (
          <section className="vault-panel vault-panel--detail vault-panel--gallery">
            <div className="vault-gallery-toolbar">
              <button
                type="button"
                className="btn btn--ghost vault-gallery-toolbar__back"
                onClick={() => setOpenAlbumId(null)}
              >
                ← All albums
              </button>
              <div className="vault-gallery-toolbar__title">
                <h2 className="vault-gallery-toolbar__name">{openAlbum.name}</h2>
                <span className="vault-gallery-toolbar__count" aria-label="Item count">
                  {files.length === 0
                    ? 'Empty'
                    : files.length === 1
                      ? '1 item'
                      : `${files.length} items`}
                </span>
              </div>
              <div className="vault-gallery-toolbar__actions">
                <div className="vault-grid-cols" role="toolbar" aria-label="Columns in grid">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`vault-grid-cols__btn ${galleryCols === n ? 'is-active' : ''}`}
                      onClick={() => setGalleryCols(n)}
                      aria-pressed={galleryCols === n}
                      title={`${n} column${n === 1 ? '' : 's'}`}
                    >
                      <GridColsIcon cols={n} />
                    </button>
                  ))}
                </div>
                <select
                  className="vault-sort-select vault-sort-select--files vault-sort-select--compact"
                  value={fileSort}
                  onChange={(e) => setFileSort(e.target.value as FileSort)}
                  aria-label="Sort files in album"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="largest">Largest</option>
                  <option value="smallest">Smallest</option>
                  <option value="images_first">Images first</option>
                  <option value="videos_first">Videos first</option>
                </select>
                <label className="btn btn--outline vault-upload-btn vault-upload-btn--toolbar" aria-disabled={uploading || !openAlbum}>
                  Upload
                  <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  disabled={uploading || !openAlbum}
                  onChange={(e) => {
                    const list = e.target.files
                    if (list && openAlbum) {
                      const filesArray = Array.from(list)
                      void (async () => {
                        if (filesArray.length === 0) return
                        if (!user) {
                          showToast('Please sign in to upload.', 'error')
                          return
                        }

                        setUploading(true)
                        setUploadProgress(0)
                        setUploadFileName(filesArray[0].name)
                        setUploadBatchTotal(filesArray.length)
                        setUploadBatchIndex(1)
                        setUploadEtaText(null)

                        try {
                          const { failed, total } = await batchUploadFilesToAlbum(
                            filesArray,
                            openAlbum.id,
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

                          const { data, error: selectError } = await supabase
                            .from('files')
                            .select('*')
                            .eq('album_id', openAlbum.id)
                            .eq('user_id', user.id)
                            .order('created_at', { ascending: false })

                          if (selectError) throw new Error(selectError.message)

                          setFiles((data as FileRow[]) ?? [])
                          await refreshAlbums()

                          if (failed.length === 0) {
                            showToast(
                              total === 1
                                ? 'Upload complete'
                                : `Uploaded ${total} file${total === 1 ? '' : 's'}`,
                            )
                          } else if (failed.length === total) {
                            showToast('All uploads failed', 'error')
                          } else {
                            showToast(
                              `Uploaded ${
                                total - failed.length
                              } of ${total} files. Failed: ${failed.join(', ')}`,
                              'error',
                            )
                          }
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
                          console.error(err)
                        } finally {
                          setUploading(false)
                          setUploadProgress(0)
                          setUploadFileName(null)
                          setUploadBatchIndex(0)
                          setUploadBatchTotal(0)
                          setUploadEtaText(null)
                        }
                      })()
                    }
                    e.currentTarget.value = ''
                  }}
                />
              </label>
              </div>
            </div>

            <UploadProgressOverlay
              uploading={uploading}
              uploadProgress={uploadProgress}
              uploadFileName={uploadFileName}
              uploadBatchIndex={uploadBatchIndex}
              uploadBatchTotal={uploadBatchTotal}
              uploadEtaText={uploadEtaText}
            />

            {filesError ? (
            <div className="banner banner--error" role="alert">
              <strong>Could not load files.</strong> {filesError}
            </div>
            ) : null}

            {filesLoading ? (
            <div className="vault-loading">Loading files…</div>
            ) : files.length === 0 ? (
            <div className="vault-empty">No files in this album yet.</div>
            ) : (
            <ul
              className="vault-grid vault-grid--gallery"
              style={
                {
                  ['--vault-gallery-cols' as string]: String(galleryCols),
                } as CSSProperties
              }
            >
              {displayFiles.map((f, i) => {
                const isVideo = isVideoFileName(f.file_name)

                return (
                  <li key={f.id} className="vault-photo-item">
                    <button
                      type="button"
                      className="vault-photo-tile"
                      onClick={() => {
                        setViewerFileId(f.id)
                        setViewerIndex(i)
                        setViewerOpen(true)
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0]
                        longPressTouchStartRef.current = { x: t.clientX, y: t.clientY }
                        longPressTimerRef.current = setTimeout(() => {
                          setFileActionTarget(f)
                          longPressTimerRef.current = null
                        }, 520)
                      }}
                      onTouchMove={(e) => {
                        const start = longPressTouchStartRef.current
                        if (!start || !longPressTimerRef.current) return
                        const t = e.touches[0]
                        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 14) {
                          clearLongPress()
                        }
                      }}
                      onTouchEnd={clearLongPress}
                      onTouchCancel={clearLongPress}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setFileActionTarget(f)
                      }}
                      aria-label={`Open ${f.file_name}`}
                    >
                      <div className="vault-photo-tile__media">
                        {isVideo ? (
                          <video src={f.file_url} muted playsInline preload="metadata" />
                        ) : (
                          <img src={f.file_url} alt="" loading="lazy" />
                        )}
                      </div>
                      {isVideo ? (
                        <span className="vault-photo-tile__video-glyph" aria-hidden title="Video">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7L8 5z" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="vault-photo-item__more"
                      aria-label={`Actions for ${f.file_name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFileActionTarget(f)
                      }}
                    >
                      ⋮
                    </button>
                  </li>
                )
              })}
            </ul>
            )}

            {fileActionTarget ? (
              <div
                className="modal-backdrop vault-action-backdrop"
                role="presentation"
                onClick={() => setFileActionTarget(null)}
              >
                <div
                  className="vault-action-sheet modal modal--enter"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="vault-file-actions-title"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <h2 id="vault-file-actions-title" className="vault-action-sheet__title">
                    {fileActionTarget.file_name}
                  </h2>
                  <div className="vault-action-sheet__list">
                    <a
                      className="vault-action-sheet__item"
                      href={fileActionTarget.file_url}
                      download={fileActionTarget.file_name}
                      onClick={() => setFileActionTarget(null)}
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      className="vault-action-sheet__item"
                      onClick={async () => {
                        const url = fileActionTarget.file_url
                        try {
                          await navigator.clipboard.writeText(url)
                          showToast('Link copied')
                        } catch {
                          showToast('Could not copy link', 'error')
                        }
                        setFileActionTarget(null)
                      }}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="vault-action-sheet__item"
                      onClick={() => {
                        setFileInfoTarget(fileActionTarget)
                        setFileActionTarget(null)
                      }}
                    >
                      File details
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost vault-action-sheet__cancel"
                    onClick={() => setFileActionTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {fileInfoTarget ? (
              <div
                className="modal-backdrop"
                role="presentation"
                onClick={() => setFileInfoTarget(null)}
              >
                <div
                  className="modal modal--enter"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="vault-file-info-title"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <h2 id="vault-file-info-title" className="modal__title">
                    File details
                  </h2>
                  <dl className="vault-file-info-dl">
                    <div>
                      <dt>Name</dt>
                      <dd title={fileInfoTarget.file_name}>{fileInfoTarget.file_name}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{new Date(fileInfoTarget.created_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{isVideoFileName(fileInfoTarget.file_name) ? 'Video' : 'Image'}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(fileInfoTarget.file_size_bytes ?? undefined)}</dd>
                    </div>
                  </dl>
                  <button type="button" className="btn btn--primary" onClick={() => setFileInfoTarget(null)}>
                    Done
                  </button>
                </div>
              </div>
            ) : null}

            <MediaViewer
              key={viewerOpen ? 'viewer-open' : 'viewer-closed'}
              open={viewerOpen}
              files={mediaFiles}
              index={viewerIndex}
              onClose={() => {
                setViewerOpen(false)
                setViewerFileId(null)
              }}
              onIndexChange={(nextIndex) => {
                setViewerIndex(nextIndex)
                const nf = displayFiles[nextIndex]
                if (nf) setViewerFileId(nf.id)
              }}
            />
          </section>
        )}
      </main>

      <CreateAlbumModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateAlbum}
      />

      <RenameAlbumModal
        open={renameTarget !== null}
        initialName={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onRename={handleRename}
      />

      <ConfirmDeleteAlbumModal
        open={deleteTarget !== null}
        albumName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <AlbumCoverPickerModal
        open={coverPickerAlbum !== null}
        album={coverPickerAlbum}
        userId={user?.id ?? ''}
        onClose={() => setCoverPickerAlbum(null)}
        onSaved={async () => {
          await refreshAlbums()
          showToast('Album cover updated')
        }}
        onRemoved={async () => {
          await refreshAlbums()
          showToast('Cover removed')
        }}
      />
    </div>
  )
}
