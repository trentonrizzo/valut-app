import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { createLink, deleteLink, listLinks, updateLink, type VaultLink } from '../lib/links'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { addLinkToAlbum } from '../lib/links'

export function LinksPage() {
  const { user } = useAuth()
  const [links, setLinks] = useState<VaultLink[]>([])
  const [q, setQ] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([])

  async function refresh() {
    if (!user) return
    try {
      setLinks(await listLinks(user.id))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not load links')
    }
  }

  useEffect(() => {
    void refresh()
    if (!user) return
    void fetchAlbumsWithCounts(user.id).then((r) => {
      if (r.data) setAlbums(r.data.map((a) => ({ id: a.id, name: a.name })))
    })
  }, [user?.id])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return links
    return links.filter(
      (l) =>
        l.url.toLowerCase().includes(needle) ||
        (l.title || '').toLowerCase().includes(needle) ||
        (l.domain || '').toLowerCase().includes(needle) ||
        (l.notes || '').toLowerCase().includes(needle),
    )
  }, [links, q])

  async function onCreate() {
    if (!user || !url.trim()) return
    setBusy(true)
    setNotice('')
    try {
      await createLink(user.id, { url, title })
      setUrl('')
      setTitle('')
      setNotice('Link saved')
      await refresh()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save link — apply intelligent-org migration if missing')
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null

  return (
    <div className="page links-page">
      <header className="page-header">
        <h1>Links</h1>
        <p className="muted">Saved URLs you can tag, favorite, and nest in collections. No R2 duplication.</p>
      </header>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search links" aria-label="Search links" />
      </div>
      <div className="row links-create">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="URL" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" />
        <button type="button" className="btn btn--primary" disabled={busy || !url.trim()} onClick={() => void onCreate()}>
          Save
        </button>
      </div>
      {notice ? <p className="muted">{notice}</p> : null}
      <ul className="links-list">
        {filtered.map((link) => (
          <li key={link.id} className="links-list__item">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="links-list__url">
              {link.title || link.domain || link.url}
            </a>
            <span className="muted">{link.domain}</span>
            <button
              type="button"
              className="btn btn--ghost"
              aria-label={link.favorite ? 'Unfavorite' : 'Favorite'}
              onClick={() =>
                void updateLink(user.id, link.id, { favorite: !link.favorite }).then(refresh)
              }
            >
              {link.favorite ? '★' : '☆'}
            </button>
            <select
              className="vault-sort-select"
              defaultValue=""
              aria-label="Add to album"
              onChange={(e) => {
                const albumId = e.target.value
                e.target.value = ''
                if (!albumId) return
                void addLinkToAlbum(user.id, albumId, link.id)
                  .then(() => setNotice('Added to collection'))
                  .catch((err) => setNotice(err instanceof Error ? err.message : 'Failed'))
              }}
            >
              <option value="">Add to album…</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (!window.confirm('Remove this link? Media is untouched.')) return
                void deleteLink(user.id, link.id).then(refresh)
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {!filtered.length ? <p className="muted">No links yet.</p> : null}
    </div>
  )
}
