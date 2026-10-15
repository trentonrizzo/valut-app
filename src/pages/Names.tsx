import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { detectPersonName, detectSourceSite, sortNameGroups, type NameGroupSort } from '../lib/nameTag'
import { backfillNameTagsBatch, GROUP_INDEX_KEY, type NameBackfillCursor } from '../lib/nameTagApply'
import { createAlbumFromGroup, type GroupAlbumMode } from '../lib/smartAlbums'
import { fetchAlbumsWithCounts } from '../lib/albumQueries'
import { listTags, mergeTags, renameTag } from '../lib/tags'
import { supabase } from '../lib/supabase'
import { classifyFileKind } from '../lib/fileKind'

type TagRow = Awaited<ReturnType<typeof listTags>>[number]
type Section = 'names' | 'sources' | 'albums'
type GroupStat = { files: number; photos: number; videos: number; links: number }

function emptyCursor(): NameBackfillCursor {
  return { phase: 'files', offset: 0, done: false }
}

function loadCursor(userId: string): NameBackfillCursor {
  try {
    const saved = JSON.parse(localStorage.getItem(`${GROUP_INDEX_KEY}:${userId}`) || 'null') as NameBackfillCursor | null
    if (saved && (saved.phase === 'files' || saved.phase === 'links') && Number.isFinite(saved.offset)) return saved
  } catch {
    /* start over */
  }
  return emptyCursor()
}

function groupHref(tag: { id: string; name: string }) {
  const params = new URLSearchParams({ tag: tag.id, title: tag.name, group: '1' })
  return `/library?${params.toString()}`
}

function statLine(stat: GroupStat | undefined): string {
  const files = stat?.files ?? 0
  const links = stat?.links ?? 0
  const total = files + links
  const parts = [`${total} item${total === 1 ? '' : 's'}`]
  if (stat?.videos) parts.push(`${stat.videos} video${stat.videos === 1 ? '' : 's'}`)
  if (stat?.photos) parts.push(`${stat.photos} photo${stat.photos === 1 ? '' : 's'}`)
  if (links) parts.push(`${links} link${links === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export function NamesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('names')
  const [tags, setTags] = useState<TagRow[]>([])
  const [sources, setSources] = useState<TagRow[]>([])
  const [stats, setStats] = useState<Record<string, GroupStat>>({})
  const [smartAlbums, setSmartAlbums] = useState<{ id: string; name: string; count: number }[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<NameGroupSort>('count')
  const [phase, setPhase] = useState<'loading' | 'indexing' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState('')
  const [runId, setRunId] = useState(0)

  async function refresh() {
    if (!user) return []
    const rows = await listTags(user.id)
    const names = rows.filter((tag) => tag.kind === 'name' || (tag.kind !== 'source' && detectPersonName({ filename: tag.name }) === tag.name))
    const sites = rows.filter((tag) => tag.kind === 'source' || (tag.kind !== 'name' && detectSourceSite({ filename: tag.name }) === tag.name))
    setTags(names)
    setSources(sites)
    const map: Record<string, GroupStat> = {}
    const ensure = (id: string) => map[id] ?? (map[id] = { files: 0, photos: 0, videos: 0, links: 0 })
    const files = await supabase.from('file_tags').select('tag_id, files!inner(deleted_at, mime_type, file_name, purpose)').eq('user_id', user.id)
    if (!files.error) {
      for (const row of files.data ?? []) {
        const file = row.files as unknown as { deleted_at?: string | null; mime_type?: string | null; file_name?: string | null; purpose?: string | null } | { deleted_at?: string | null; mime_type?: string | null; file_name?: string | null; purpose?: string | null }[] | null
        const item = Array.isArray(file) ? file[0] : file
        if (!item || item.deleted_at || item.purpose === 'cover') continue
        const stat = ensure(row.tag_id)
        stat.files += 1
        const kind = classifyFileKind({ name: item.file_name || '', mime_type: item.mime_type })
        if (kind === 'video') stat.videos += 1
        else if (kind === 'image') stat.photos += 1
      }
    } else {
      const plain = await supabase.from('file_tags').select('tag_id').eq('user_id', user.id)
      for (const row of plain.data ?? []) ensure(row.tag_id).files += 1
    }
    const links = await supabase.from('link_tags').select('tag_id, vault_links!inner(deleted_at)').eq('user_id', user.id)
    if (!links.error) {
      for (const row of links.data ?? []) {
        const link = row.vault_links as unknown as { deleted_at?: string | null } | { deleted_at?: string | null }[] | null
        const item = Array.isArray(link) ? link[0] : link
        if (item?.deleted_at) continue
        ensure(row.tag_id).links += 1
      }
    }
    setStats(map)
    const albums = await fetchAlbumsWithCounts(user.id)
    setSmartAlbums((albums.data ?? []).filter((album) => album.smart_tag_id).map((album) => ({
      id: album.id,
      name: album.name,
      count: album.itemCount,
    })))
    return names
  }

  useEffect(() => {
    if (!user) return
    let cancel = false
    void (async () => {
      setPhase('loading')
      try {
        await refresh()
      } catch (error) {
        if (!cancel) {
          setPhase('error')
          setNotice(error instanceof Error ? error.message : 'Groups could not be loaded')
        }
        return
      }
      if (cancel) return
      let cursor = loadCursor(user.id)
      if (cursor.done) {
        setPhase('ready')
        setNotice('')
        return
      }
      setPhase('indexing')
      let scanned = 0
      let tagged = 0
      try {
        for (let i = 0; i < 400 && !cancel; i++) {
          const batch = await backfillNameTagsBatch(user.id, cursor)
          scanned += batch.scanned
          tagged += batch.tagged
          cursor = batch.cursor
          localStorage.setItem(`${GROUP_INDEX_KEY}:${user.id}`, JSON.stringify(cursor))
          if (i % 2 === 1 || cursor.done) await refresh()
          if (!cancel) setNotice(cursor.done ? '' : `Organizing your library… ${scanned} checked, ${tagged} labels saved`)
          if (cursor.done) break
        }
        if (!cancel) setPhase('ready')
      } catch (error) {
        if (!cancel) {
          setPhase('ready')
          setNotice(error instanceof Error ? error.message : 'Indexing paused')
        }
      }
    })()
    return () => { cancel = true }
    // refresh reads the latest signed-in user; rerun only when that user or a retry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, runId])

  const rows = section === 'sources' ? sources : tags
  const filtered = useMemo(
    () => sortNameGroups(rows.map((tag) => ({ ...tag, count: (stats[tag.id]?.files ?? 0) + (stats[tag.id]?.links ?? 0) })), sort, q),
    [rows, q, stats, sort],
  )
  const albumRows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return smartAlbums.filter((album) => !needle || album.name.toLowerCase().includes(needle))
  }, [smartAlbums, q])

  async function onRename(tag: TagRow) {
    if (!user) return
    const next = window.prompt('Rename group', tag.name)
    if (!next || next.trim() === tag.name) return
    await renameTag(user.id, tag.id, next)
    await refresh()
  }

  async function onMerge(tag: TagRow) {
    if (!user) return
    const typed = window.prompt('Merge into which group?', '')?.trim().toLowerCase()
    const target = tags.find((item) => item.id !== tag.id && item.name.toLowerCase() === typed)
    if (!target) return
    await mergeTags(user.id, tag.id, target.id)
    await refresh()
  }

  async function onCreateAlbum(tag: TagRow, mode: GroupAlbumMode) {
    if (!user) return
    const albumName = window.prompt(mode === 'smart' ? 'Smart album name' : 'Album name', tag.name)
    if (!albumName?.trim()) return
    try {
      const album = await createAlbumFromGroup(user.id, { name: albumName, tagId: tag.id, mode })
      if (mode === 'smart') {
        setNotice(`“${album.name}” updates whenever this name is tagged.`)
        await refresh()
        setSection('albums')
        return
      }
      navigate(`/albums/${album.id}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create album')
    }
  }

  if (!user) return null
  const showEmpty = phase === 'ready' && ((section === 'albums' && albumRows.length === 0) || (section !== 'albums' && filtered.length === 0))

  return (
    <div className="groups-page">
      <header className="groups-page__head">
        <h1>Smart Groups</h1>
        <p>Automatically organized from your library</p>
      </header>
      <div className="groups-switch" role="tablist" aria-label="Group types">
        {([
          ['names', 'Names'],
          ['sources', 'Sources'],
          ['albums', 'Smart Albums'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="groups-tools">
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search groups" aria-label="Search groups" />
        <div className="groups-sort" role="group" aria-label="Sort groups">
          <button type="button" className={sort === 'count' ? 'is-active' : ''} onClick={() => setSort('count')}>Count</button>
          <button type="button" className={sort === 'name' ? 'is-active' : ''} onClick={() => setSort('name')}>A–Z</button>
        </div>
      </div>
      {phase === 'loading' ? <div className="groups-skeleton" aria-busy="true"><span /><span /><span /></div> : null}
      {phase === 'indexing' ? <p className="groups-status">{notice || 'Organizing your library…'}</p> : null}
      {phase === 'error' ? (
        <div className="groups-error" role="alert">
          <p>{notice || 'Groups could not be loaded.'}</p>
          <button type="button" className="btn btn--outline" onClick={() => setRunId((n) => n + 1)}>Retry</button>
        </div>
      ) : null}
      {notice && phase === 'ready' ? <p className="groups-status">{notice}</p> : null}
      {section === 'albums' ? (
        <ul className="groups-list">
          {albumRows.map((album) => (
            <li key={album.id}>
              <Link to={`/albums/${album.id}`} className="group-card">
                <span className="group-card__mark" aria-hidden>{album.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{album.name}</strong>
                  <small>Smart album · {album.count} items</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="groups-list">
          {filtered.map((tag) => (
            <li key={tag.id}>
              <Link to={groupHref(tag)} className="group-card">
                <span className="group-card__mark" aria-hidden>{tag.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{tag.name}</strong>
                  <small>{statLine(stats[tag.id])}</small>
                </span>
              </Link>
              {section === 'names' ? (
                <div className="group-card__actions">
                  <button type="button" onClick={() => void onCreateAlbum(tag, 'normal')}>Album</button>
                  <button type="button" onClick={() => void onCreateAlbum(tag, 'smart')}>Smart album</button>
                  <button type="button" onClick={() => void onRename(tag)}>Rename</button>
                  <button type="button" onClick={() => void onMerge(tag)}>Merge</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {showEmpty ? (
        <p className="groups-empty">
          {section === 'albums'
            ? 'Smart albums you create from a name will stay updated here.'
            : 'No supported names were recognized in filenames, titles, or saved links.'}
        </p>
      ) : null}
    </div>
  )
}
