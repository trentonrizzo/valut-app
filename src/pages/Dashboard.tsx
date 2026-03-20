import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'

type AlbumRow = Database['public']['Tables']['albums']['Row']

async function queryAlbums(userId: string) {
  return supabase
    .from('albums')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
}

export function Dashboard() {
  const { user, signOut } = useAuth()
  const [albums, setAlbums] = useState<AlbumRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const refreshAlbums = useCallback(async () => {
    if (!user) return
    const { data, error } = await queryAlbums(user.id)
    if (error) {
      setFetchError(error.message)
      setAlbums([])
      return
    }
    setFetchError(null)
    setAlbums(data ?? [])
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    ;(async () => {
      const { data, error } = await queryAlbums(user.id)
      if (cancelled) return
      if (error) {
        setFetchError(error.message)
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
    const { error } = await supabase.from('albums').insert({
      user_id: user.id,
      name,
    })
    if (error) throw new Error(error.message)
    await refreshAlbums()
  }

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
            <h1 className="dashboard__title">Your albums</h1>
            <p className="dashboard__subtitle">Create collections to organize future uploads.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
            Create album
          </button>
        </div>

        {fetchError ? (
          <div className="banner banner--error" role="alert">
            <strong>Could not load albums.</strong> {fetchError}
          </div>
        ) : null}

        {loading ? (
          <div className="app-loading app-loading--inline">
            <div className="spinner" aria-hidden />
            <p>Loading albums…</p>
          </div>
        ) : (
          <AlbumGrid albums={albums} />
        )}
      </main>

      <CreateAlbumModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreateAlbum}
      />
    </div>
  )
}
