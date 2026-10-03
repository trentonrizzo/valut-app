import { useEffect, useState } from 'react'
import { displayLinkName, loadLinkRelations, type VaultLink } from '../../lib/links'

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

export function LinkDetailsSheet({ userId, link, onClose }: { userId: string; link: VaultLink | null; onClose: () => void }) {
  const [relations, setRelations] = useState<{ albums: string[]; tags: string[] } | null>(null)
  useEffect(() => {
    if (!link) return
    let cancelled = false
    setRelations(null)
    void loadLinkRelations(userId, link.id).then((value) => { if (!cancelled) setRelations(value) }).catch(() => {
      if (!cancelled) setRelations({ albums: [], tags: [] })
    })
    return () => { cancelled = true }
  }, [link, userId])
  if (!link) return null
  const rows = [
    ['Name', displayLinkName(link)],
    ['Provider', link.provider || link.domain || 'Unknown'],
    ['Created', formatDate(link.provider_created_at)],
    ['Imported', formatDate(link.imported_at || link.created_at)],
    ['URL', link.url],
    ['Tags', relations ? relations.tags.join(', ') || 'None' : '…'],
    ['Albums / folders', relations ? relations.albums.join(', ') || 'None' : '…'],
    ['Favorite', link.favorite ? 'Yes' : 'No'],
  ]
  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close link details" onClick={onClose} />
      <div className="sheet sheet--details" role="dialog" aria-label="Link details">
        <div className="sheet__handle" />
        <h2 className="sheet__title">Link details</h2>
        <dl className="media-details">
          {rows.map(([label, value]) => (
            <div key={label} className="media-details__row">
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn btn--outline btn--block" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
