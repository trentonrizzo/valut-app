import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import {
  addLinkToAlbum,
  addTagsToLinks,
  importLinks,
  listLinks,
  softDeleteLinks,
  updateLink,
  type VaultLink,
} from '../lib/links'
import { copyLinkToClipboard, parseLinksIncrementally, safeOpenLink, type ParsedLink } from '../lib/linkParser'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { createTag, listTags } from '../lib/tags'

const REVIEW_PAGE = 50

export function LinksPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [params] = useSearchParams()
  const [links, setLinks] = useState<VaultLink[]>([])
  const [q, setQ] = useState('')
  const [paste, setPaste] = useState('')
  const [review, setReview] = useState<ParsedLink[]>([])
  const [selectedReview, setSelectedReview] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [reviewVisible, setReviewVisible] = useState(REVIEW_PAGE)
  const [albums, setAlbums] = useState<{ id: string; name: string; parent_album_id?: string | null }[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [albumId, setAlbumId] = useState(() => params.get('album') || '')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [newTags, setNewTags] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [tagMode, setTagMode] = useState<'and' | 'or'>('and')
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [filterAlbumId, setFilterAlbumId] = useState('')
  const [importDuplicates, setImportDuplicates] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      setLinks(await listLinks(user.id, { search: q, favorite: favoriteOnly || undefined, albumId: filterAlbumId || null, tagIds: filterTagIds, tagMode }))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load links', 'error')
    }
  }, [user, q, favoriteOnly, filterAlbumId, filterTagIds, tagMode, showToast])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!user) return
    void fetchAlbumsWithCounts(user.id).then((result) => {
      if (result.data) setAlbums(result.data.map((album) => ({ id: album.id, name: album.name, parent_album_id: album.parent_album_id })))
    })
    void listTags(user.id).then((rows) => setTags(rows.map((tag) => ({ id: tag.id, name: tag.name })))).catch(() => {})
  }, [user])

  const visibleReview = useMemo(() => review.slice(0, reviewVisible), [review, reviewVisible])

  async function parsePaste() {
    setBusy(true)
    setProgress(0)
    try {
      const rows = await parseLinksIncrementally(paste, setProgress)
      setReview(rows)
      setSelectedReview(new Set(rows.map((row) => row.id)))
      setReviewVisible(REVIEW_PAGE)
      if (!rows.length) showToast('No valid http:// or https:// links found.', 'error')
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function importSelected() {
    if (!user) return
    const rows = review.filter((row) => selectedReview.has(row.id))
    if (!rows.length) return
    setBusy(true)
    try {
      const chosenTags = [...tagIds]
      for (const name of newTags.split(',').map((value) => value.trim()).filter(Boolean)) {
        const tag = await createTag(user.id, name)
        if (!chosenTags.includes(tag.id)) chosenTags.push(tag.id)
      }
      const result = await importLinks(user.id, rows, { albumId: albumId || null, tagIds: chosenTags, importExistingDuplicates: importDuplicates })
      setReview([])
      setSelectedReview(new Set())
      setPaste('')
      setNewTags('')
      showToast(`${result.created.length} link(s) added${result.skippedExisting ? `, ${result.skippedExisting} existing skipped` : ''}${result.failed.length ? `, ${result.failed.length} failed` : ''}`, result.failed.length ? 'error' : 'success')
      await refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Import failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null

  return (
    <div className="page links-page">
      <header className="page-header">
        <h1>Links</h1>
        <p className="muted">Private saved URLs. Vault never fetches previews or protected content.</p>
      </header>

      <section className="links-import" aria-label="Add links">
        <label className="field-label" htmlFor="links-paste">Paste one or more links</label>
        <textarea
          id="links-paste"
          className="field-input links-import__paste"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          onDrop={(event) => {
            const text = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list')
            if (text) { event.preventDefault(); setPaste((previous) => `${previous}${previous ? '\n' : ''}${text}`) }
          }}
          placeholder={'Paste a URL or a block copied from Apple Notes…'}
          rows={5}
        />
        <button type="button" className="btn btn--primary" disabled={busy || !paste.trim()} onClick={() => void parsePaste()}>
          {progress == null ? 'Detect links' : `Detecting… ${progress}%`}
        </button>
      </section>

      {review.length ? (
        <section className="links-review">
          <div className="links-review__header">
            <strong>{review.length} link{review.length === 1 ? '' : 's'} detected</strong>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedReview(new Set(selectedReview.size === review.length ? [] : review.map((row) => row.id)))}>
              {selectedReview.size === review.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="links-review__destinations">
            <select className="vault-sort-select" value={albumId} onChange={(event) => setAlbumId(event.target.value)} aria-label="Destination album or folder">
              <option value="">No album / folder</option>
              {albums.map((album) => <option key={album.id} value={album.id}>{album.parent_album_id ? '↳ ' : ''}{album.name}</option>)}
            </select>
            <select className="vault-sort-select" value="" onChange={(event) => { const id = event.target.value; if (id && !tagIds.includes(id)) setTagIds([...tagIds, id]) }} aria-label="Add existing tag">
              <option value="">Add tag…</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
            <input className="field-input" value={newTags} onChange={(event) => setNewTags(event.target.value)} placeholder="New tags, comma separated" />
            <label className="links-review__duplicate"><input type="checkbox" checked={importDuplicates} onChange={(event) => setImportDuplicates(event.target.checked)} /> Import URLs already in Vault</label>
          </div>
          <ul className="links-review__list">
            {visibleReview.map((row) => (
              <li key={row.id} className="links-review__row">
                <input type="checkbox" checked={selectedReview.has(row.id)} onChange={() => { const next = new Set(selectedReview); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); setSelectedReview(next) }} />
                <div className="links-review__identity"><strong>{row.domain}</strong><span title={row.url}>{row.url}</span></div>
                <input className="field-input" value={row.title} onChange={(event) => setReview((all) => all.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} placeholder="Name (optional)" />
              </li>
            ))}
          </ul>
          {reviewVisible < review.length ? <button type="button" className="btn btn--outline" onClick={() => setReviewVisible((value) => value + REVIEW_PAGE)}>Show next {Math.min(REVIEW_PAGE, review.length - reviewVisible)}</button> : null}
          <button type="button" className="btn btn--primary" disabled={busy || selectedReview.size === 0} onClick={() => void importSelected()}>Add {selectedReview.size} Links</button>
        </section>
      ) : null}

      <section className="links-tools">
        <input className="field-input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search name, domain, URL, notes…" aria-label="Search links" />
        <button type="button" className={`filter-chip ${favoriteOnly ? 'is-active' : ''}`} onClick={() => setFavoriteOnly((value) => !value)}>Favorites</button>
        <select className="vault-sort-select" value={filterAlbumId} onChange={(event) => setFilterAlbumId(event.target.value)}><option value="">Any album</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}</select>
        <select className="vault-sort-select" value="" onChange={(event) => { const id = event.target.value; if (id && !filterTagIds.includes(id)) setFilterTagIds([...filterTagIds, id]) }}><option value="">Filter by tag…</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
        {filterTagIds.length ? <select className="vault-sort-select" value={tagMode} onChange={(event) => setTagMode(event.target.value as 'and' | 'or')}><option value="and">Match all tags</option><option value="or">Match any tag</option></select> : null}
      </section>

      {selected.size ? (
        <div className="bulk-bar">
          <strong>{selected.size} selected</strong>
          <select className="vault-sort-select" value="" onChange={(event) => { const id = event.target.value; event.target.value = ''; if (id) void Promise.all([...selected].map((linkId) => addLinkToAlbum(user.id, id, linkId))).then(() => showToast('Added to album')) }}><option value="">Add to album…</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}</select>
          <button type="button" className="btn btn--outline" onClick={() => { const raw = window.prompt('Tag names, comma separated'); if (!raw) return; void (async () => { const ids = []; for (const name of raw.split(',').map((value) => value.trim()).filter(Boolean)) ids.push((await createTag(user.id, name)).id); await addTagsToLinks(user.id, [...selected], ids); showToast('Links tagged') })() }}>Tag</button>
          <button type="button" className="btn btn--outline" onClick={() => void Promise.all([...selected].map((id) => updateLink(user.id, id, { favorite: true }))).then(refresh)}>Favorite</button>
          <button type="button" className="btn btn--danger" onClick={() => { if (!window.confirm(`Move ${selected.size} link(s) to Recently Deleted?`)) return; void softDeleteLinks(user.id, [...selected]).then(() => { setSelected(new Set()); return refresh() }) }}>Delete</button>
        </div>
      ) : null}

      <ul className="links-list">
        {links.map((link) => (
          <li key={link.id} className={`links-list__item ${selected.has(link.id) ? 'is-selected' : ''}`}>
            <label className="links-list__select"><input type="checkbox" checked={selected.has(link.id)} onChange={() => { const next = new Set(selected); if (next.has(link.id)) next.delete(link.id); else next.add(link.id); setSelected(next) }} /></label>
            <button type="button" className="links-list__open" onClick={() => { if (!safeOpenLink(link.url)) showToast('Only safe http/https links can be opened.', 'error') }}>
              <span className="links-list__icon" aria-hidden>↗</span>
              <span><strong>{link.title || link.domain || 'Link'}</strong><small>{link.domain || 'Unknown domain'}</small></span>
            </button>
            <button type="button" className="btn btn--ghost" aria-label={link.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => void updateLink(user.id, link.id, { favorite: !link.favorite }).then(refresh)}>{link.favorite ? '★' : '☆'}</button>
            <button type="button" className="btn btn--ghost" onClick={() => void copyLinkToClipboard(link.url).then((ok) => showToast(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'error'))}>Copy</button>
            <button type="button" className="btn btn--ghost" title={link.url} onClick={() => {
              const title = window.prompt('Link name', link.title || '')
              if (title == null) return
              const url = window.prompt('Full URL', link.url)
              if (url == null) return
              const notes = window.prompt('Notes', link.notes || '')
              if (notes == null) return
              void updateLink(user.id, link.id, { title, url, notes }).then(refresh).catch((error) => showToast(error instanceof Error ? error.message : 'Update failed', 'error'))
            }}>Edit</button>
          </li>
        ))}
      </ul>
      {!links.length ? <p className="muted">No matching links.</p> : null}
    </div>
  )
}
