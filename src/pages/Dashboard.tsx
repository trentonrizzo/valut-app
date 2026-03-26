import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { fetchAlbumsWithCounts, mapAlbumRow } from '../lib/albumQueries'
import { uploadToVault, deleteFromVault } from '../../lib/vaultApi'
import type { AlbumWithMeta } from '../types/album'
import type { VaultFile } from '../types/vault-file'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'
import { RenameAlbumModal } from '../components/albums/RenameAlbumModal'
import { ConfirmDeleteAlbumModal } from '../components/albums/ConfirmDeleteAlbumModal'
import { ConfirmDeleteFileModal } from '../components/albums/ConfirmDeleteFileModal'

function fileTypeFromMime(mime: string) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

function keyFromUrl(url: string) {
  const str = String(url || '').trim()
  if (!str) return ''

  const marker = '/'
  if (/^https?:\/\//i.test(str)) {
    const parts = str.split('://')
    if (parts.length < 2) return ''
    const afterHost = parts[1].split('/').slice(1).join('/')
    return afterHost || ''
  }

  return str.startsWith(marker) ? str.slice(1) : str
}

export function Dashboard() {
  const { user, session, signOut } = useAuth()
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
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([])
  const [vaultLoading, setVaultLoading] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleteFileTarget, setDeleteFileTarget] = useState<VaultFile | null>(null)
  const [deletingFile, setDeletingFile] = useState(false)

  const accessToken = session?.access_token ?? ''

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

  const refreshAlbumFiles = useCallback(async () => {
    if (!openAlbumId) {
      setVaultFiles([])
      return
    }

    setVaultLoading(true)
    setVaultError(null)

    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('album_id', openAlbumId)
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)

      setVaultFiles((data as VaultFile[]) ?? [])
    } catch (e) {
      setVaultFiles([])
      setVaultError(e instanceof Error ? e.message : 'Could not load album files')
    } finally {
      setVaultLoading(false)
    }
  }, [openAlbumId])

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
    void refreshAlbumFiles()
  }, [refreshAlbumFiles])

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

      const real = mapAlbumRow({ ...data, items: [{ count: 0 }] })
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

  async function handleUploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    if (!user || !accessToken) {
      showToast('You must be signed in to upload files', 'error')
      return
    }
    if (!openAlbum) {
      showToast('Open an album before uploading', 'error')
      return
    }

    setUploading(true)

    try {
      const files = Array.from(fileList)

      for (const file of files) {
        const uploadResult = await uploadToVault(file, user.id, openAlbum.name, accessToken)

        const { error: itemError } = await supabase.from('items').insert({
          album_id: openAlbum.id,
          type: fileTypeFromMime(file.type),
          url: uploadResult.url,
        })

        if (itemError) {
          const key = uploadResult.key || keyFromUrl(uploadResult.url)
          if (key) {
            try {
              await deleteFromVault(key, user.id, accessToken)
            } catch (cleanupErr) {
              console.error('Cleanup after metadata failure failed:', cleanupErr)
            }
          }

          throw new Error(`Uploaded to storage, but saving metadata failed: ${itemError.message}`)
        }
      }

      await refreshAlbumFiles()
      await refreshAlbums()
      showToast(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteFileConfirm() {
    if (!deleteFileTarget || !user || !accessToken) return

    setDeletingFile(true)

    try {
      const key = keyFromUrl(deleteFileTarget.url)
      if (!key) throw new Error('Could not determine storage object key from file URL')

      await deleteFromVault(key, user.id, accessToken)

      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', deleteFileTarget.id)
        .eq('album_id', deleteFileTarget.album_id)

      if (error) {
        throw new Error(`Storage delete succeeded, but metadata delete failed: ${error.message}`)
      }

      setVaultFiles((prev) => prev.filter((f) => f.id !== deleteFileTarget.id))
      await refreshAlbums()
      showToast('File deleted')
      setDeleteFileTarget(null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error')
    } finally {
      setDeletingFile(false)
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
              {uploading ? 'Uploading…' : 'Upload files'}
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                disabled={uploading || !openAlbum}
                onChange={(e) => {
                  void handleUploadFiles(e.target.files)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>

          {vaultError ? (
            <div className="banner banner--error" role="alert">
              <strong>Could not load files.</strong> {vaultError}
            </div>
          ) : null}

          {vaultLoading ? (
            <div className="vault-loading">Loading files…</div>
          ) : !openAlbum ? (
            <div className="vault-empty">Select an album to view files.</div>
          ) : vaultFiles.length === 0 ? (
            <div className="vault-empty">No files in this album yet.</div>
          ) : (
            <ul className="vault-grid">
              {vaultFiles.map((file) => (
                <li key={file.id} className="vault-file-card">
                  <a href={file.url} target="_blank" rel="noreferrer" className="vault-file-preview">
                    {file.type === 'image' ? (
                      <img src={file.url} alt="Uploaded file" loading="lazy" />
                    ) : file.type === 'video' ? (
                      <video src={file.url} muted playsInline preload="metadata" />
                    ) : (
                      <div className="vault-file-fallback">FILE</div>
                    )}
                  </a>
                  <div className="vault-file-meta">
                    <p className="vault-file-name" title={file.url}>
                      {file.url.split('/').pop() ?? 'file'}
                    </p>
                    <p className="vault-file-sub">{new Date(file.created_at).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost vault-delete-btn"
                    onClick={() => setDeleteFileTarget(file)}
                    disabled={deletingFile}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
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

      <ConfirmDeleteFileModal
        open={deleteFileTarget !== null}
        fileName={deleteFileTarget?.url.split('/').pop() ?? ''}
        onClose={() => setDeleteFileTarget(null)}
        onConfirm={handleDeleteFileConfirm}
        deleting={deletingFile}
      />
    </div>
  )
}
