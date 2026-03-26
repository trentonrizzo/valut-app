import { useCallback, useEffect, useMemo, useState } from 'react'
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
  }

  const [files, setFiles] = useState<FileRow[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)

  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)

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

  const openAlbum = useMemo(
    () => albums.find((a) => a.id === openAlbumId) ?? null,
    [albums, openAlbumId],
  )

  const mediaFiles = useMemo(
    () => files.map((f) => ({ id: f.id, file_url: f.file_url, file_name: f.file_name, created_at: f.created_at })),
    [files],
  )

  useEffect(() => {
    setViewerOpen(false)
    setViewerIndex(0)
  }, [openAlbumId])

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
        if (!openAlbumId && list.length > 0) {
          setOpenAlbumId(list[0].id)
        }
      }

      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [user, openAlbumId])

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

  async function handleUpload(file: File, albumId: string) {
    if (!file) return
    if (!user) {
      showToast('Please sign in to upload.', 'error')
      return
    }
    if (!albumId) {
      showToast('Open an album before uploading.', 'error')
      return
    }

    const activeAlbum = albums.find((a) => a.id === albumId)
    if (!activeAlbum) {
      showToast('Album not found.', 'error')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setUploadFileName(file.name)

    try {
      const presignRes = await fetch("/api/r2-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      })

      const presign = await presignRes.json()

      if (!presignRes.ok || presign?.ok !== true || !presign.uploadUrl || !presign.fileUrl) {
        throw new Error(presign?.error || 'Could not create upload URL')
      }

      const { uploadUrl, fileUrl } = presign as { uploadUrl: string; fileUrl: string }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", uploadUrl, true)
        xhr.setRequestHeader("Content-Type", "application/octet-stream")

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(percent)
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100)
            resolve()
          }
          else reject(new Error(`Upload failed (${xhr.status})`))
        }

        xhr.onerror = () => reject(new Error('Upload failed'))

        xhr.send(file)
      })

      const { error: insertError } = await supabase.from('files').insert({
        user_id: user.id,
        album_id: albumId,
        file_name: file.name,
        file_url: fileUrl,
      })

      if (insertError) throw new Error(insertError.message)

      const { data, error: selectError } = await supabase
        .from('files')
        .select('*')
        .eq('album_id', albumId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (selectError) throw new Error(selectError.message)

      setFiles((data as FileRow[]) ?? [])
      await refreshAlbums()

      showToast('Upload complete')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error')
      console.error(e)
    } finally {
      setUploading(false)
      setUploadProgress(0)
      setUploadFileName(null)
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
        <div className="dashboard__toolbar">
          <div>
            <h1 className="dashboard__title">Albums</h1>
            <p className="dashboard__subtitle">
              {loading ? 'Loading…' : albumCountLabel} · Click an album to open its gallery
            </p>
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
            busyAlbumIds={busyIds}
            activeAlbumId={openAlbumId}
            onOpen={(album) => setOpenAlbumId(album.id)}
            onRename={(a) => setRenameTarget(a)}
            onDelete={(a) => setDeleteTarget(a)}
            onCreateClick={() => setCreateModalOpen(true)}
          />
        )}

        <section className="vault-panel">
          <div className="vault-panel__header">
            <h2 className="vault-panel__title">
              {openAlbum ? `Files in ${openAlbum.name}` : 'Open an album'}
            </h2>
            <p className="vault-panel__subtitle">
              {openAlbum
                ? 'Upload images and videos directly into this album'
                : 'Select an album card above to view and upload files'}
            </p>
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
                  const file = e.target.files?.[0]
                  if (file && openAlbum) {
                    void handleUpload(file, openAlbum.id)
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
                  Uploading
                </h2>
                <p className="modal__body-text">{uploadFileName ?? 'File'}</p>
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
                <p className="modal__body-text" style={{ marginTop: '0.6rem' }}>
                  {uploadProgress}%
                </p>
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
          ) : !openAlbum ? (
            <div className="vault-empty">Select an album to view files.</div>
          ) : files.length === 0 ? (
            <div className="vault-empty">No files in this album yet.</div>
          ) : (
            <ul className="vault-grid">
              {files.map((f, i) => {
                const lower = f.file_name.toLowerCase()
                const isVideo = /\.(mp4|webm|ogg|mov|mkv)$/i.test(lower)

                return (
                  <li key={f.id} className="vault-file-card">
                    <button
                      type="button"
                      className="vault-file-tile-btn"
                      onClick={() => {
                        setViewerIndex(i)
                        setViewerOpen(true)
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

          <MediaViewer
            key={viewerOpen ? mediaFiles[viewerIndex]?.id ?? 'viewer' : 'viewer'}
            open={viewerOpen}
            files={mediaFiles}
            index={viewerIndex}
            onClose={() => setViewerOpen(false)}
            onIndexChange={(nextIndex) => setViewerIndex(nextIndex)}
          />
        </section>
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
