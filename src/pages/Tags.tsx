import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { createTag, listTags, renameTag } from '../lib/tags'
import { supabase } from '../lib/supabase'

type TagRow = Awaited<ReturnType<typeof listTags>>[number]

export function TagsPage() {
  const { user } = useAuth()
  const [tags, setTags] = useState<TagRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  async function refresh() {
    if (!user) return
    const rows = await listTags(user.id)
    setTags(rows)
    const map: Record<string, number> = {}
    const { data: ft } = await supabase.from('file_tags').select('tag_id').eq('user_id', user.id)
    for (const row of ft || []) {
      map[row.tag_id] = (map[row.tag_id] || 0) + 1
    }
    setCounts(map)
  }

  useEffect(() => {
    void refresh()
  }, [user?.id])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(needle))
  }, [tags, q])

  async function onCreate() {
    if (!user || !name.trim()) return
    setBusy(true)
    setNotice('')
    try {
      await createTag(user.id, name)
      setName('')
      setNotice('Tag created')
      await refresh()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not create tag')
    } finally {
      setBusy(false)
    }
  }

  async function onRename(tag: TagRow) {
    if (!user) return
    const next = window.prompt('Rename tag', tag.name)
    if (!next || next.trim() === tag.name) return
    try {
      await renameTag(user.id, tag.id, next)
      setNotice('Renamed')
      await refresh()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  if (!user) return null

  return (
    <div className="page tags-page">
      <header className="page-header">
        <h1>Tags</h1>
        <p className="muted">Create and manage tags without AI. Empty tags are allowed.</p>
      </header>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags" aria-label="Search tags" />
      </div>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" aria-label="New tag" />
        <button type="button" className="btn btn--primary" disabled={busy || !name.trim()} onClick={() => void onCreate()}>
          Create
        </button>
      </div>
      {notice ? <p className="muted">{notice}</p> : null}
      <ul className="tag-manager-list">
        {filtered.map((tag) => (
          <li key={tag.id} className="tag-manager-list__item">
            <Link to={`/library?tag=${tag.id}`} className="tag-chip">
              {tag.name}
            </Link>
            <span className="muted">{counts[tag.id] || 0}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void onRename(tag)}>
              Rename
            </button>
          </li>
        ))}
      </ul>
      {!filtered.length ? <p className="muted">No tags yet.</p> : null}
    </div>
  )
}
