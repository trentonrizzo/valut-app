import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { fetchAlbumsWithCounts, mapAlbumRow } from '../lib/albumQueries'
import type { AlbumWithMeta } from '../types/album'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'
import { RenameAlbumModal } from '../components/albums/RenameAlbumModal'
import { ConfirmDeleteAlbumModal } from '../components/albums/ConfirmDeleteAlbumModal'
import { MediaViewer } from '../components/files/MediaViewer'

function isVideoFileName(name: string) {
  return /\.(mp4|webm|ogg|mov|mkv)$/i.test(String(name || '').toLowerCase())
}

function formatFileSizeBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

export function Dashboard() {
  const { user, signOut } = useAuth()
  const { showToast } = useToast()

  const [albums, setAlbums] = useState<AlbumWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AlbumWithMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AlbumWithMeta | null>(null)
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

  type AlbumSort = 'newest' | 'oldest' | 'az' | 'za'
  const [albumSort, setAlbumSort] = useState<AlbumSort>('newest')

  type FileSort =
    | 'newest'
    | 'oldest'
    | 'largest'
    | 'smallest'
    | 'images_first'
    | 'videos_first'
  const [fileSort, setFileSort] = useState<FileSort>('newest')

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

  const sortedAlbums = useMemo(() => {
    const list = [...albums]
    switch (albumSort) {
      case 'az':
        return list.sort((a, b) => a.name.localeCompare(b.name))
      case 'za':
        return list.sort((a, b) => b.name.localeCompare(a.name))
      case 'oldest':
        return list.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
      case 'newest':
      default:
        return list.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
    }
  }, [albums, albumSort])

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
    const optimistic: AlbumWithMeta = {
      id: tempId,
      user_id: user.id,
      name,
      created_at: new Date().toISOString(),
      itemCount: 0,
    }

    setAlbums((prev) => [optimistic, ...prev])
    setCreatingAlbum(true)

    try {
      const { data, error } = await supabase
        .from('albums')
        .insert({ user_id: user.id, name })
        .select()
        .single()

      if (error) throw new Error(error.message)

      const real = mapAlbumRow({ ...data, files: [{ count: 0 }] })
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

    setAlbums((prev) => prev.filter((a) => a.id !== id))
    if (openAlbumId === id) setOpenAlbumId(null)
    setDeleteTarget(null)

    try {
      const { error } = await supabase.from('albums').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw new Error(error.message)
      showToast('Album deleted')
    } catch (e) {
      setAlbums((prev) =>
        [...prev, removed].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      )
      showToast(e instanceof Error ? e.message : 'Could not delete album', 'error')
    }
  }

  const albumCountLabel =
    albums.length === 0 ? 'No albums' : albums.length === 1 ? '1 album' : `${albums.length} albums`

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div className="dashboard__brand">
          <Link to="/dashboard" className="dashboard__logo">
            Vault
          </Link>
          <span className="dashboard__tagline">Cloud storage</span>
        </div>
        <div className="dashboard__user">
          <span className="dashboard__email" title={user?.email ?? undefined}>
            {user?.email}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

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
                <select
                  className="vault-sort-select"
                  value={albumSort}
                  onChange={(e) => setAlbumSort(e.target.value as AlbumSort)}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="az">A–Z</option>
                  <option value="za">Z–A</option>
                </select>
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
                albums={sortedAlbums}
                busyAlbumIds={busyIds}
                activeAlbumId={openAlbumId}
                onOpen={(album) => setOpenAlbumId(album.id)}
                onRename={(a) => setRenameTarget(a)}
                onDelete={(a) => setDeleteTarget(a)}
                onCreateClick={() => setCreateModalOpen(true)}
              />
            )}
          </>
        ) : (
          <section className="vault-panel vault-panel--detail">
            <div className="vault-panel__header vault-panel__header--detail">
              <button
                type="button"
                className="btn btn--ghost vault-back-btn"
                onClick={() => setOpenAlbumId(null)}
              >
                ← All albums
              </button>
              <div>
                <h2 className="vault-panel__title">{openAlbum.name}</h2>
                <p className="vault-panel__subtitle">
                  {files.length === 0
                    ? 'No files yet'
                    : files.length === 1
                      ? '1 item'
                      : `${files.length} items`}
                </p>
              </div>
              <div className="vault-panel__header-actions">
                <label className="vault-file-sort-label">
                  <span className="vault-file-sort-label__text">Sort</span>
                  <select
                    className="vault-sort-select vault-sort-select--files"
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
                </label>
              </div>
            </div>

            <div className="vault-controls">
              <label className="btn btn--outline vault-upload-btn" aria-disabled={uploading || !openAlbum}>
                Upload files
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
                        const totalBytes = filesArray.reduce((s, f) => s + f.size, 0)
                        uploadTotalBytesRef.current = totalBytes
                        uploadStartMsRef.current = Date.now()

                        const total = filesArray.length
                        let index = 0
                        let completedBytes = 0
                        const failed: string[] = []

                        try {
                          for (const file of filesArray) {
                            index += 1
                            setUploadFileName(file.name)
                            setUploadBatchIndex(index)

                            try {
                              const presignRes = await fetch('/api/r2-upload-url', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ fileName: file.name }),
                              })

                              const presign = await presignRes.json()

                              if (
                                !presignRes.ok ||
                                presign?.ok !== true ||
                                !presign.uploadUrl ||
                                !presign.fileUrl
                              ) {
                                throw new Error(presign?.error || 'Could not create upload URL')
                              }

                              const { uploadUrl, fileUrl } = presign as {
                                uploadUrl: string
                                fileUrl: string
                              }

                              await new Promise<void>((resolve, reject) => {
                                const xhr = new XMLHttpRequest()
                                xhr.open('PUT', uploadUrl, true)
                                xhr.setRequestHeader('Content-Type', 'application/octet-stream')

                                xhr.upload.onprogress = (event) => {
                                  if (!event.lengthComputable || totalBytes <= 0) return
                                  const currentFileBytes = (event.loaded / event.total) * file.size
                                  const totalDone = completedBytes + currentFileBytes
                                  const overallPct = Math.round((totalDone / totalBytes) * 100)
                                  setUploadProgress(Math.min(100, overallPct))

                                  const elapsed = Date.now() - uploadStartMsRef.current
                                  if (elapsed > 2500 && overallPct > 2 && overallPct < 99) {
                                    const rate = totalDone / elapsed
                                    if (rate > 0) {
                                      const remainingMs = (totalBytes - totalDone) / rate
                                      if (remainingMs > 4000 && remainingMs < 1000 * 60 * 60 * 4) {
                                        const sec = Math.ceil(remainingMs / 1000)
                                        setUploadEtaText(
                                          sec < 60 ? `~${sec}s left` : `~${Math.round(sec / 60)}m left`,
                                        )
                                      } else {
                                        setUploadEtaText(null)
                                      }
                                    }
                                  } else if (elapsed <= 2500) {
                                    setUploadEtaText(null)
                                  }
                                }

                                xhr.onload = () => {
                                  if (xhr.status >= 200 && xhr.status < 300) {
                                    resolve()
                                  } else {
                                    reject(new Error(`Upload failed (${xhr.status})`))
                                  }
                                }

                                xhr.onerror = () => reject(new Error('Upload failed'))

                                xhr.send(file)
                              })

                              completedBytes += file.size

                              const { error: insertError } = await supabase.from('files').insert({
                                user_id: user.id,
                                album_id: openAlbum.id,
                                file_name: file.name,
                                file_url: fileUrl,
                                file_size_bytes: file.size,
                              })

                              if (insertError) throw new Error(insertError.message)
                            } catch (err) {
                              failed.push(file.name)
                              console.error('Upload failed for file:', file.name, err)
                              continue
                            }
                          }

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
                      })()
                    }
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            </div>

            {uploading ? (
            <div className="modal-backdrop" role="presentation">
              <div
                className="modal modal--enter"
                role="dialog"
                aria-modal="true"
                aria-labelledby="upload-progress-title"
                onClick={(ev) => ev.stopPropagation()}
              >
                <h2 id="upload-progress-title" className="modal__title">
                  Uploading files
                </h2>
                <p className="modal__body-text vault-upload-batch">
                  {uploadBatchTotal > 0 ? (
                    <span className="vault-upload-batch__count">
                      {uploadBatchIndex} of {uploadBatchTotal}
                    </span>
                  ) : null}
                  {uploadBatchTotal > 0 ? ' · ' : null}
                  {uploadProgress}%
                </p>
                <p className="modal__body-text vault-upload-current-name" title={uploadFileName ?? undefined}>
                  {uploadFileName ?? 'File'}
                </p>
                {uploadEtaText ? (
                  <p className="modal__body-text vault-upload-eta">{uploadEtaText}</p>
                ) : null}
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: 'var(--border)',
                    overflow: 'hidden',
                    marginTop: '0.75rem',
                  }}
                  aria-label="Upload progress"
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${uploadProgress}%`,
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,255,255,0.35))',
                      transition: 'width 0.15s ease',
                    }}
                  />
                </div>
              </div>
            </div>
            ) : null}

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
            <ul className="vault-grid vault-grid--gallery">
              {displayFiles.map((f, i) => {
                const isVideo = isVideoFileName(f.file_name)

                return (
                  <li key={f.id} className="vault-file-card">
                    <div className="vault-file-card__top">
                      <button
                        type="button"
                        className="vault-file-tile-btn"
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
                        <div className="vault-file-preview">
                          <span className={`vault-type-pill ${isVideo ? 'is-video' : 'is-image'}`}>
                            {isVideo ? 'Video' : 'Image'}
                          </span>
                          {isVideo ? (
                            <video src={f.file_url} muted playsInline preload="metadata" />
                          ) : (
                            <img src={f.file_url} alt={f.file_name} loading="lazy" />
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="vault-file-more-btn"
                        aria-label={`Actions for ${f.file_name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setFileActionTarget(f)
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                    <div className="vault-file-meta">
                      <p className="vault-file-name" title={f.file_name}>
                        {f.file_name}
                      </p>
                      <p className="vault-file-sub">{new Date(f.created_at).toLocaleString()}</p>
                    </div>
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
                      <dd>{formatFileSizeBytes(fileInfoTarget.file_size_bytes ?? undefined)}</dd>
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
    </div>
  )
}
