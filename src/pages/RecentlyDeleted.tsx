import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { emptyRecentlyDeleted, listDeletedFiles, permanentDeleteFiles, restoreFiles } from '../lib/trash'
import { classifyFileKind, fileKindLabel } from '../lib/fileKind'
import type { FileRow } from '../types/media'
import { formatBytes } from '../lib/formatBytes'
import { listLinks, permanentlyDeleteLinks, restoreLinks, type VaultLink } from '../lib/links'

export function RecentlyDeleted() {
  const { user, session } = useAuth()
  const { showToast } = useToast()
  const [rows, setRows] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<VaultLink[]>([])
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      setRows(await listDeletedFiles(user.id))
      setLinks(await listLinks(user.id, { includeDeleted: true }))
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not load Recently Deleted', 'error')
    } finally {
      setLoading(false)
    }
  }, [user, showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function restoreSelected() {
    if (!user || selected.size === 0) return
    if (!window.confirm(`Restore ${selected.size} item(s) to their previous albums when possible?`)) return
    setBusy(true)
    try {
      await restoreFiles(user.id, [...selected])
      showToast('Restored')
      setSelected(new Set())
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Restore failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function destroySelected() {
    const token = session?.access_token
    if (!token || selected.size === 0) return
    if (!window.confirm(`Permanently delete ${selected.size} item(s) from storage? This cannot be undone.`)) return
    if (!window.confirm('Last chance: delete the original R2 object(s) forever?')) return
    setBusy(true)
    try {
      await permanentDeleteFiles(token, [...selected])
      showToast('Permanently deleted')
      setSelected(new Set())
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Permanent delete failed. Nothing was pretended as deleted.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function emptyAll() {
    const token = session?.access_token
    if (!token || rows.length + links.length === 0 || !user) return
    if (!window.confirm(`Empty Recently Deleted (${rows.length + links.length} items)? This permanently deletes originals and saved links.`)) return
    if (!window.confirm('Type-level confirm: permanently delete everything in trash?')) return
    setBusy(true)
    try {
      await emptyRecentlyDeleted(token)
      await permanentlyDeleteLinks(user.id, links.map((link) => link.id))
      showToast('Recently Deleted emptied')
      setSelected(new Set())
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Empty failed. Retry the remaining items.', 'error')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function restoreSelectedLinks() {
    if (!user || selectedLinks.size === 0) return
    await restoreLinks(user.id, [...selectedLinks])
    setSelectedLinks(new Set())
    await load()
  }

  async function destroySelectedLinks() {
    if (!user || selectedLinks.size === 0) return
    if (!window.confirm('Permanently delete selected saved links?')) return
    await permanentlyDeleteLinks(user.id, [...selectedLinks])
    setSelectedLinks(new Set())
    await load()
  }

  return (
    <div className="dashboard">
      <main className="dashboard__main">
        <div className="dashboard__toolbar">
          <div>
            <h1 className="dashboard__title">Recently Deleted</h1>
            <p className="dashboard__subtitle">Soft-deleted items. Restore or permanently delete.</p>
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="bulk-bar">
            <span className="bulk-bar__count">{selected.size} selected</span>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void restoreSelected()}>
              Restore
            </button>
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void destroySelected()}>
              Delete permanently
            </button>
          </div>
        ) : null}
        <div className="filter-bar">
          <button type="button" className="btn btn--outline" disabled={busy || rows.length + links.length === 0} onClick={() => void emptyAll()}>
            Empty Recently Deleted
          </button>
        </div>
        {selectedLinks.size > 0 ? (
          <div className="bulk-bar">
            <span className="bulk-bar__count">{selectedLinks.size} link(s) selected</span>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void restoreSelectedLinks()}>Restore links</button>
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void destroySelectedLinks()}>Delete links permanently</button>
          </div>
        ) : null}
        {loading ? (
          <div className="vault-loading">Loading…</div>
        ) : rows.length === 0 && links.length === 0 ? (
          <div className="vault-empty">Nothing in Recently Deleted.</div>
        ) : (
          <ul className="deleted-list">
            {rows.map((f) => {
              const kind = classifyFileKind({ name: f.file_name, mime_type: f.mime_type })
              return (
                <li key={f.id} className={`deleted-row ${selected.has(f.id) ? 'is-selected' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => {
                        const next = new Set(selected)
                        if (next.has(f.id)) next.delete(f.id)
                        else next.add(f.id)
                        setSelected(next)
                      }}
                    />
                    <span className="deleted-row__kind">{fileKindLabel(kind)}</span>
                    <span className="deleted-row__name">{f.file_name}</span>
                    <span className="deleted-row__meta">
                      {formatBytes(f.file_size_bytes ?? 0)} · {f.deleted_at ? new Date(f.deleted_at).toLocaleString() : ''}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {links.length ? (
          <ul className="deleted-list">
            {links.map((link) => (
              <li key={`link-${link.id}`} className={`deleted-row ${selectedLinks.has(link.id) ? 'is-selected' : ''}`}>
                <label>
                  <input type="checkbox" checked={selectedLinks.has(link.id)} onChange={() => { const next = new Set(selectedLinks); if (next.has(link.id)) next.delete(link.id); else next.add(link.id); setSelectedLinks(next) }} />
                  <span className="deleted-row__kind">Link</span>
                  <span className="deleted-row__name">{link.title || link.domain || 'Saved link'}</span>
                  <span className="deleted-row__meta">{link.deleted_at ? new Date(link.deleted_at).toLocaleString() : ''}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  )
}
