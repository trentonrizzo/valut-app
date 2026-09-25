import { useCallback, useEffect, useState } from 'react'
import type { FileRow, MediaFilters } from '../../types/media'
import { DEFAULT_MEDIA_FILTERS } from '../../types/media'
import { listMediaPage } from '../../lib/mediaQueries'
import { listTags } from '../../lib/tags'
import { fetchAlbumsWithCounts } from '../../lib/albumQueries'
import { classifyFileKind } from '../../lib/fileKind'
import { VaultPhotoTileMedia } from '../files/VaultPhotoTile'

const MAX_PICK = 4

type Props = {
  open: boolean
  userId: string
  onClose: () => void
  onAdd: (files: FileRow[]) => void
  maxSelect?: number
}

type Quick = 'all' | 'photos' | 'videos' | 'favorites'

export function EditorMediaPicker({ open, userId, onClose, onAdd, maxSelect = MAX_PICK }: Props) {
  const [rows, setRows] = useState<FileRow[]>([])
  const [cursor, setCursor] = useState<{ ts: string | null; id: string; num: number | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [quick, setQuick] = useState<Quick>('all')
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [tagId, setTagId] = useState<string | null>(null)
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  const filters: MediaFilters = {
    ...DEFAULT_MEDIA_FILTERS,
    search,
    type: quick === 'photos' ? 'photos' : quick === 'videos' ? 'videos' : 'all',
    favorite: quick === 'favorites' ? 'yes' : 'all',
    albumId,
    tagIds: tagId ? [tagId] : [],
  }

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const page = await listMediaPage({
          userId,
          filters,
          cursor: reset ? null : cursor,
          limit: 36,
        })
        setRows((prev) => (reset ? page.rows : [...prev, ...page.rows]))
        setCursor(page.nextCursor)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load media')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when filter keys change
    [userId, search, quick, albumId, tagId, cursor],
  )

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSearch('')
    setQuick('all')
    setAlbumId(null)
    setTagId(null)
    setCursor(null)
    void listTags(userId).then(setTags).catch(() => {})
    void fetchAlbumsWithCounts(userId)
      .then((res) => setAlbums((res.data ?? []).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {})
  }, [open, userId])

  useEffect(() => {
    if (!open) return
    setCursor(null)
    void (async () => {
      setLoading(true)
      try {
        const page = await listMediaPage({ userId, filters, cursor: null, limit: 36 })
        setRows(page.rows)
        setCursor(page.nextCursor)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load media')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, search, quick, albumId, tagId])

  if (!open) return null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < maxSelect) next.add(id)
      return next
    })
  }

  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close media picker" onClick={onClose} />
      <div className="sheet sheet--editor-picker" role="dialog" aria-label="Add media">
        <div className="sheet__handle" />
        <div className="editor-picker__top">
          <h2 className="sheet__title">Add media</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Done
          </button>
        </div>
        <input
          className="field-input"
          placeholder="Search filename, album, tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search media"
        />
        <div className="filter-quick" role="toolbar" aria-label="Picker filters">
          {(
            [
              ['all', 'All'],
              ['videos', 'Videos'],
              ['photos', 'Photos'],
              ['favorites', 'Favorites'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`filter-quick__chip ${quick === id ? 'is-active' : ''}`}
              onClick={() => setQuick(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="editor-picker__selects">
          <label>
            Albums
            <select
              className="field-input"
              value={albumId ?? ''}
              onChange={(e) => setAlbumId(e.target.value || null)}
            >
              <option value="">All albums</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags
            <select className="field-input" value={tagId ?? ''} onChange={(e) => setTagId(e.target.value || null)}>
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="editor-picker-grid editor-picker-grid--large">
          {rows.map((f) => {
            const kind = classifyFileKind({ name: f.file_name, mime_type: f.mime_type })
            if (kind !== 'image' && kind !== 'video') return null
            const on = selected.has(f.id)
            return (
              <button
                key={f.id}
                type="button"
                className={`editor-picker-tile ${on ? 'is-selected' : ''}`}
                onClick={() => toggle(f.id)}
                aria-pressed={on}
              >
                <VaultPhotoTileMedia file={f} userId={userId} />
                {kind === 'video' ? <span className="vault-photo-tile__video-glyph" aria-hidden /> : null}
                {f.favorite ? <span className="vault-photo-tile__fav">★</span> : null}
                {on ? <span className="editor-picker-tile__check" aria-hidden>
                  ✓
                </span> : null}
              </button>
            )
          })}
        </div>
        {loading ? <p className="muted">Loading…</p> : null}
        {cursor ? (
          <button
            type="button"
            className="btn btn--outline"
            disabled={loading}
            onClick={() => void load(false)}
          >
            Load more
          </button>
        ) : null}
        <div className="editor-picker__footer">
          <span>
            {selected.size} selected · max {maxSelect}
          </span>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.size === 0}
            onClick={() => {
              const files = rows.filter((r) => selected.has(r.id))
              onAdd(files)
            }}
          >
            Add {selected.size || ''}
          </button>
        </div>
      </div>
    </div>
  )
}
