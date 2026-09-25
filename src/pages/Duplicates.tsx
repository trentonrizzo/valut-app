import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { fetchDuplicateGroups, type DuplicateGroup } from '../lib/storageStats'
import { formatBytes } from '../lib/formatBytes'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../types/media'

export function Duplicates() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [previews, setPreviews] = useState<Record<string, FileRow>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const next = await fetchDuplicateGroups()
      setGroups(next)
      const ids = next.flatMap((g) => g.file_ids.slice(0, 4))
      if (ids.length) {
        const { data } = await supabase
          .from('files')
          .select('id, file_name, created_at, file_size_bytes, mime_type, favorite')
          .eq('user_id', user.id)
          .in('id', ids)
        const map: Record<string, FileRow> = {}
        for (const row of (data ?? []) as FileRow[]) map[row.id] = row
        setPreviews(map)
      } else {
        setPreviews({})
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not load duplicates', 'error')
    } finally {
      setLoading(false)
    }
  }, [user, showToast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Duplicates</h1>
        <p className="settings-placeholder">
          Exact content matches by SHA-256. Nothing is deleted or merged automatically — this view is informational.
        </p>
      </header>
      <div className="settings-page__body">
        {loading ? <div className="vault-loading">Scanning…</div> : null}
        {!loading && groups.length === 0 ? (
          <div className="vault-empty">
            No duplicate groups yet. New uploads are hashed automatically after the latest migration. Existing media can be
            indexed progressively later.
          </div>
        ) : null}
        <ul className="dup-list">
          {groups.map((g) => (
            <li key={g.content_hash} className="dup-card">
              <div className="dup-card__head">
                <strong>{g.file_count} copies</strong>
                <span>{formatBytes(g.total_bytes)} referenced</span>
              </div>
              <p className="dup-card__hash" title={g.content_hash}>
                {g.content_hash.slice(0, 16)}…
              </p>
              <ul className="dup-card__files">
                {g.file_ids.slice(0, 8).map((id) => {
                  const f = previews[id]
                  return (
                    <li key={id}>
                      <Link to={`/library/media/${id}`}>{f?.file_name || id.slice(0, 8)}</Link>
                      {f?.created_at ? (
                        <span className="dup-card__meta"> · imported {new Date(f.created_at).toLocaleDateString()}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
