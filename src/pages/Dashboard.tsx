import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { fetchAlbumsWithCounts, mapAlbumRow } from '../lib/albumQueries'
import { uploadToVault, getVaultFiles, deleteFromVault } from '../../lib/vaultApi'
import type { AlbumWithMeta } from '../types/album'
import type { VaultFile } from '../types/vault-file'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'
import { RenameAlbumModal } from '../components/albums/RenameAlbumModal'
import { ConfirmDeleteAlbumModal } from '../components/albums/ConfirmDeleteAlbumModal'
import { ConfirmDeleteFileModal } from '../components/albums/ConfirmDeleteFileModal'

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / 1024 ** idx
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

function slugifyAlbum(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

  const [selectedAlbum, setSelectedAlbum] = useState('')
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

  const refreshVaultFiles = useCallback(async () => {
    if (!user || !accessToken) return
    setVaultLoading(true)
    setVaultError(null)
    try {
      const files = await getVaultFiles(user.id, accessToken)
      setVaultFiles(files)
    } catch (e) {
      setVaultFiles([])
      setVaultError(e instanceof Error ? e.message : 'Could not load vault files')
    } finally {
      setVaultLoading(false)
    }
  }, [user, accessToken])

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
        setFetchError(null)
        setAlbums(data ?? [])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (user && accessToken) {
      void refreshVaultFiles()
    }
  }, [user, accessToken, refreshVaultFiles])

  useEffect(() => {
    if (!selectedAlbum && albums.length > 0) {
      setSelectedAlbum(albums[0].name)
    }
  }, [albums, selectedAlbum])

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
      if (!selectedAlbum) setSelectedAlbum(name)
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
    if (selectedAlbum === prevName) setSelectedAlbum(newName)
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
      if (selectedAlbum === newName) setSelectedAlbum(prevName)
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
    if (selectedAlbum === removed.name) setSelectedAlbum('')
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
    if (!selectedAlbum) {
      showToast('Choose an album before uploading', 'error')
      return
    }

    setUploading(true)
    try {
      const files = Array.from(fileList)
      for (const file of files) {
        await uploadToVault(file, user.id, selectedAlbum, accessToken)
      }
      await refreshVaultFiles()
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
      await deleteFromVault(deleteFileTarget.key, user.id, accessToken)
      setVaultFiles((prev) => prev.filter((f) => f.key !== deleteFileTarget.key))
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

  const albumOptions = useMemo(() => {
    return albums.map((a) => ({ label: a.name, slug: slugifyAlbum(a.name) }))
  }, [albums])

  const selectedAlbumSlug = slugifyAlbum(selectedAlbum)
  const filteredFiles = selectedAlbumSlug
    ? vaultFiles.filter((f) => f.key.includes(`/albums/${selectedAlbumSlug}/`))
    : vaultFiles

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
              {loading ? 'Loading…' : albumCountLabel} · Organize your library
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
            onRename={(a) => setRenameTarget(a)}
            onDelete={(a) => setDeleteTarget(a)}
            onCreateClick={() => setCreateModalOpen(true)}
          />
        )}

        <section className="vault-panel">
          <div className="vault-panel__header">
            <h2 className="vault-panel__title">Files</h2>
            <p className="vault-panel__subtitle">Upload images and videos to your selected album</p>
          </div>

          <div className="vault-controls">
            <label className="vault-field">
              <span>Album</span>
              <select
                value={selectedAlbum}
                onChange={(e) => setSelectedAlbum(e.target.value)}
                disabled={uploading || albums.length === 0}
              >
                {albums.length === 0 ? (
                  <option value="">No albums available</option>
                ) : (
                  albumOptions.map((album) => (
                    <option key={album.slug} value={album.label}>
                      {album.label}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="btn btn--outline vault-upload-btn" aria-disabled={uploading || albums.length === 0}>
              {uploading ? 'Uploading…' : 'Upload files'}
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                disabled={uploading || albums.length === 0}
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
          ) : filteredFiles.length === 0 ? (
            <div className="vault-empty">No files in this album yet.</div>
          ) : (
            <ul className="vault-grid">
              {filteredFiles.map((file) => (
                <li key={file.key} className="vault-file-card">
                  <div className="vault-file-preview">
                    <div className="vault-file-fallback">FILE</div>
                  </div>
                  <div className="vault-file-meta">
                    <p className="vault-file-name" title={file.key}>
                      {file.key.split('/').pop() ?? file.key}
                    </p>
                    <p className="vault-file-sub">
                      {formatSize(file.size)}{file.lastModified ? ` · ${new Date(file.lastModified).toLocaleString()}` : ''}
                    </p>
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
        fileName={deleteFileTarget?.key?.split('/').pop() ?? ''}
        onClose={() => setDeleteFileTarget(null)}
        onConfirm={handleDeleteFileConfirm}
        deleting={deletingFile}
      />
    </div>
  )
}
