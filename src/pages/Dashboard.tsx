import { useCallback, useEffect, useState } from 'react'
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

  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

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
