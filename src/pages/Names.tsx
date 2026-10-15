import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { detectPersonName, detectSourceSite, sortNameGroups, type NameGroupSort } from '../lib/nameTag'
import { backfillNameTagsBatch, type NameBackfillCursor } from '../lib/nameTagApply'
import { createAlbumFromGroup, type GroupAlbumMode } from '../lib/smartAlbums'
import { listTags, mergeTags, renameTag } from '../lib/tags'
import { supabase } from '../lib/supabase'

type TagRow = Awaited<ReturnType<typeof listTags>>[number]

function cursorKey(userId: string) {
  return `vault-name-tag-backfill-v1:${userId}`
}

function loadCursor(userId: string): NameBackfillCursor {
  try {
    const saved = JSON.parse(localStorage.getItem(cursorKey(userId)) || 'null') as NameBackfillCursor | null
    if (saved && typeof saved === 'object') return saved
  } catch {
    /* start over */
  }
  return { createdAt: null, id: null, done: false }
}

function groupHref(tag: { id: string; name: string }) {
  const params = new URLSearchParams({ tag: tag.id, title: tag.name, group: '1' })
  return `/library?${params.toString()}`
}

export function NamesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tags, setTags] = useState<TagRow[]>([])
  const [sources, setSources] = useState<TagRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<NameGroupSort>('count')
  const [scanNonce, setScanNonce] = useState(0)
  const [notice, setNotice] = useState('Looking for names in filenames…')

  async function refresh() {
    if (!user) return []
    const rows = await listTags(user.id)
    const names = rows.filter((tag) => tag.kind === 'name' || (tag.kind !== 'source' && detectPersonName({ filename: tag.name }) === tag.name))
    const sites = rows.filter((tag) => tag.kind === 'source' || (tag.kind !== 'name' && detectSourceSite({ filename: tag.name }) === tag.name))
    setTags(names)
    setSources(sites)
    const map: Record<string, number> = {}
    const { data: ft } = await supabase.from('file_tags').select('tag_id').eq('user_id', user.id)
    for (const row of ft || []) map[row.tag_id] = (map[row.tag_id] || 0) + 1
    setCounts(map)
    return names
  }

  useEffect(() => {
    if (!user) return
    let cancel = false
    void (async () => {
      let cursor = loadCursor(user.id)
      let scanned = 0
      let tagged = 0
      const found = new Set<string>()
      if (!cursor.done) {
        for (let i = 0; i < 200 && !cancel; i++) {
          const batch = await backfillNameTagsBatch(user.id, cursor)
          scanned += batch.scanned
          tagged += batch.tagged
          cursor = batch.cursor
          localStorage.setItem(cursorKey(user.id), JSON.stringify(cursor))
          if (cursor.done) break
        }
      }
      if (cancel) return
      const names = await refresh()
      names.forEach((tag) => found.add(tag.name))
      setNotice(cursor.done
        ? `${found.size} names · ${scanned} filenames checked · ${tagged} tag links written`
        : `Scanning filenames… ${scanned} checked, ${tagged} tag links written`)
    })().catch((error) => {
      if (!cancel) setNotice(error instanceof Error ? error.message : 'Name scan failed')
    })
    return () => { cancel = true }
  }, [user?.id, scanNonce])

  const filtered = useMemo(
    () => sortNameGroups(tags.map((tag) => ({ ...tag, count: counts[tag.id] || 0 })), sort, q),
    [tags, q, counts, sort],
  )
  const filteredSources = useMemo(
    () => sortNameGroups(sources.map((tag) => ({ ...tag, count: counts[tag.id] || 0 })), sort, q),
    [sources, q, counts, sort],
  )

  async function onRename(tag: TagRow) {
    if (!user) return
    const next = window.prompt('Rename name', tag.name)
    if (!next || next.trim() === tag.name) return
    await renameTag(user.id, tag.id, next)
    await refresh()
  }

  async function onCreateAlbum(tag: TagRow, mode: GroupAlbumMode) {
    if (!user) return
    const albumName = window.prompt(mode === 'smart' ? 'Smart album name' : 'Album name', tag.name)
    if (!albumName?.trim()) return
    try {
      const album = await createAlbumFromGroup(user.id, { name: albumName, tagId: tag.id, mode })
      if (mode === 'smart') {
        setNotice(`Smart album “${album.name}” follows this name.`)
        return
      }
      navigate(`/albums/${album.id}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create album')
    }
  }

  async function onMerge(tag: TagRow) {
    if (!user) return
    const typed = window.prompt('Merge into which name?', '')?.trim().toLowerCase()
    const target = tags.find((item) => item.id !== tag.id && item.name.toLowerCase() === typed)
    if (!target) return
    await mergeTags(user.id, tag.id, target.id)
    await refresh()
  }

  if (!user) return null

  return (
    <div className="page tags-page">
      <header className="page-header">
        <h1>Names</h1>
        <p className="muted">{notice}</p>
      </header>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search names" />
        <select aria-label="Sort groups" value={sort} onChange={(event) => setSort(event.target.value as NameGroupSort)}>
          <option value="count">File count</option>
          <option value="name">Alphabetical</option>
        </select>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            localStorage.removeItem(cursorKey(user.id))
            setScanNonce((n) => n + 1)
          }}
        >
          Scan filenames
        </button>
      </div>
      <ul className="tag-manager-list">
        {filtered.map((tag) => (
          <li key={tag.id} className="tag-manager-list__item">
            <Link to={groupHref(tag)} className="tag-chip">{tag.name}</Link>
            <span className="muted">{tag.count}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void onRename(tag)}>Rename</button>
            <button type="button" className="btn btn--ghost" onClick={() => void onMerge(tag)}>Merge</button>
            <button type="button" className="btn btn--ghost" onClick={() => void onCreateAlbum(tag, 'normal')}>Album</button>
            <button type="button" className="btn btn--ghost" onClick={() => void onCreateAlbum(tag, 'smart')}>Smart album</button>
          </li>
        ))}
      </ul>
      {!filtered.length ? <p className="muted">No recognizable names yet.</p> : null}
      {filteredSources.length ? (
        <>
          <h2>Sources</h2>
          <ul className="tag-manager-list">
            {filteredSources.map((tag) => (
              <li key={tag.id} className="tag-manager-list__item">
                <Link to={groupHref(tag)} className="tag-chip">{tag.name}</Link>
                <span className="muted">{tag.count}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
