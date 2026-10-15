import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { detectPersonName } from '../lib/nameTag'
import { backfillNameTagsBatch, type NameBackfillCursor } from '../lib/nameTagApply'
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

export function NamesPage() {
  const { user } = useAuth()
  const [tags, setTags] = useState<TagRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [scanNonce, setScanNonce] = useState(0)
  const [notice, setNotice] = useState('Looking for names in filenames…')

  async function refresh() {
    if (!user) return []
    const rows = await listTags(user.id)
    const names = rows.filter((tag) => tag.kind === 'name' || detectPersonName({ filename: tag.name }) === tag.name)
    setTags(names)
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = [...tags].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name))
    if (!needle) return rows
    return rows.filter((tag) => tag.name.toLowerCase().includes(needle))
  }, [tags, q, counts])

  async function onRename(tag: TagRow) {
    if (!user) return
    const next = window.prompt('Rename name', tag.name)
    if (!next || next.trim() === tag.name) return
    await renameTag(user.id, tag.id, next)
    await refresh()
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
            <Link to={`/library?tag=${tag.id}`} className="tag-chip">{tag.name}</Link>
            <span className="muted">{counts[tag.id] || 0}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void onRename(tag)}>Rename</button>
            <button type="button" className="btn btn--ghost" onClick={() => void onMerge(tag)}>Merge</button>
          </li>
        ))}
      </ul>
      {!filtered.length ? <p className="muted">No recognizable names yet.</p> : null}
    </div>
  )
}
