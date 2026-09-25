import { useEffect, useMemo, useState } from 'react'
import type { MediaFilters, MediaSort, ResolutionPreset } from '../../types/media'
import { advancedFilterCount, clearAdvancedFilters } from '../../lib/libraryFilters'

type Props = {
  filters: MediaFilters
  onChange: (next: MediaFilters) => void
  tags: { id: string; name: string }[]
  albums?: { id: string; name: string }[]
}

const SORTS: { id: MediaSort; label: string }[] = [
  { id: 'newest_upload', label: 'Newest import' },
  { id: 'oldest_upload', label: 'Oldest import' },
  { id: 'newest_captured', label: 'Newest created' },
  { id: 'oldest_captured', label: 'Oldest created' },
  { id: 'largest', label: 'Largest' },
  { id: 'smallest', label: 'Smallest' },
  { id: 'longest', label: 'Longest' },
  { id: 'shortest', label: 'Shortest' },
  { id: 'highest_res', label: 'Highest resolution' },
  { id: 'lowest_res', label: 'Lowest resolution' },
  { id: 'highest_rating', label: 'Highest rating' },
  { id: 'favorites_first', label: 'Favorites first' },
]

type QuickId = 'all' | 'photos' | 'videos' | 'favorites' | 'tags' | 'more'

export function FilterBar({ filters, onChange, tags, albums = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [tagMenu, setTagMenu] = useState(false)
  const [draft, setDraft] = useState(filters)
  const count = advancedFilterCount(filters)

  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const setDraftPatch = (patch: Partial<MediaFilters>) => setDraft((d) => ({ ...d, ...patch }))

  const activeQuick: QuickId =
    filters.favorite === 'yes'
      ? 'favorites'
      : filters.type === 'photos'
        ? 'photos'
        : filters.type === 'videos'
          ? 'videos'
          : filters.tagIds.length > 0
            ? 'tags'
            : 'all'

  const activePills = useMemo(() => {
    const pills: { key: string; label: string; clear: Partial<MediaFilters> }[] = []
    if (filters.type === 'photos') pills.push({ key: 'type', label: 'Photos', clear: { type: 'all' } })
    if (filters.type === 'videos') pills.push({ key: 'type', label: 'Videos', clear: { type: 'all' } })
    if (filters.favorite === 'yes') pills.push({ key: 'fav', label: 'Favorites', clear: { favorite: 'all' } })
    if (filters.domain) pills.push({ key: 'domain', label: filters.domain, clear: { domain: null } })
    for (const id of filters.tagIds) {
      const t = tags.find((x) => x.id === id)
      pills.push({
        key: `tag-${id}`,
        label: t?.name ?? 'Tag',
        clear: { tagIds: filters.tagIds.filter((x) => x !== id) },
      })
    }
    if (filters.albumId) {
      const a = albums.find((x) => x.id === filters.albumId)
      pills.push({ key: 'album', label: a?.name ?? 'Album', clear: { albumId: null, noAlbum: false } })
    }
    if (filters.capturedFrom || filters.capturedTo) {
      const y = (filters.capturedFrom || filters.capturedTo || '').slice(0, 4)
      pills.push({
        key: 'captured',
        label: y || 'Captured',
        clear: { capturedFrom: null, capturedTo: null },
      })
    }
    return pills
  }, [filters, tags, albums])

  function applyQuick(id: QuickId) {
    if (id === 'more') {
      setOpen(true)
      return
    }
    if (id === 'tags') {
      setTagMenu((v) => !v)
      return
    }
    if (id === 'all') {
      onChange({
        ...filters,
        type: 'all',
        favorite: 'all',
        tagIds: [],
        domain: null,
        resultTitle: null,
      })
      return
    }
    if (id === 'photos') onChange({ ...filters, type: 'photos', favorite: 'all' })
    if (id === 'videos') onChange({ ...filters, type: 'videos', favorite: 'all' })
    if (id === 'favorites') onChange({ ...filters, favorite: 'yes', type: 'all' })
  }

  return (
    <div className="library-controls">
      {filters.resultTitle ? (
        <div className="smart-result-banner" role="status">
          <strong>{filters.resultTitle}</strong>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onChange({ ...filters, resultTitle: null })}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <input
        className="field-input filter-bar__search"
        placeholder="Search photos, videos, files..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        aria-label="Search library"
      />
      <div className="filter-quick" role="toolbar" aria-label="Quick filters">
        {(
          [
            ['all', 'All'],
            ['photos', 'Photos'],
            ['videos', 'Videos'],
            ['favorites', 'Favorites'],
            ['tags', 'Tags'],
            ['more', count > 0 ? `More (${count})` : 'More'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`filter-quick__chip ${activeQuick === id ? 'is-active' : ''}`}
            onClick={() => applyQuick(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tagMenu ? (
        <div className="filter-tag-menu">
          {tags.length === 0 ? <p className="muted">No tags yet. Create some in Tags.</p> : null}
          {tags.map((t) => {
            const on = filters.tagIds.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className={`filter-chip ${on ? 'is-active' : ''}`}
                onClick={() => {
                  const tagIds = on ? filters.tagIds.filter((x) => x !== t.id) : [...filters.tagIds, t.id]
                  onChange({ ...filters, tagIds })
                }}
              >
                {t.name}
                {on ? ' ×' : ''}
              </button>
            )
          })}
        </div>
      ) : null}
      {activePills.length > 0 ? (
        <div className="filter-active" aria-label="Active filters">
          {activePills.map((p) => (
            <button
              key={p.key}
              type="button"
              className="filter-chip"
              onClick={() => onChange({ ...filters, ...p.clear })}
            >
              {p.label} ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="library-controls__row">
        <select
          className="vault-sort-select"
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as MediaSort })}
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {open ? (
        <div className="sheet-root">
          <button type="button" className="sheet-backdrop" aria-label="Close filters" onClick={() => setOpen(false)} />
          <div className="sheet" role="dialog" aria-label="More filters">
            <div className="sheet__handle" />
            <h2 className="sheet__title">More filters</h2>
            <div className="filter-bar filter-bar--sheet">
              <select className="vault-sort-select" value={draft.type} onChange={(e) => setDraftPatch({ type: e.target.value as MediaFilters['type'] })}>
                <option value="all">All types</option>
                <option value="photos">Photos</option>
                <option value="videos">Videos</option>
              </select>
              <select className="vault-sort-select" value={draft.favorite} onChange={(e) => setDraftPatch({ favorite: e.target.value as MediaFilters['favorite'] })}>
                <option value="all">All</option>
                <option value="yes">Favorites</option>
                <option value="no">Not favorited</option>
              </select>
              <select
                className="vault-sort-select"
                value={draft.albumId ?? (draft.noAlbum ? '__none__' : '')}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__none__') setDraftPatch({ albumId: null, noAlbum: true })
                  else if (!v) setDraftPatch({ albumId: null, noAlbum: false })
                  else setDraftPatch({ albumId: v, noAlbum: false })
                }}
              >
                <option value="">Any album</option>
                <option value="__none__">No album</option>
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <label className="filter-bar__num">
                Source / domain
                <input
                  className="field-input"
                  type="text"
                  placeholder="example.com"
                  value={draft.domain ?? ''}
                  onChange={(e) => setDraftPatch({ domain: e.target.value.trim() || null })}
                />
              </label>
              <select
                className="vault-sort-select"
                value=""
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) return
                  if (draft.tagIds.includes(id)) return
                  setDraftPatch({ tagIds: [...draft.tagIds, id] })
                }}
              >
                <option value="">Add tag filter</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {draft.tagIds.length > 0 ? (
                <div className="filter-bar__tags">
                  {draft.tagIds.map((id) => {
                    const t = tags.find((x) => x.id === id)
                    return (
                      <button
                        key={id}
                        type="button"
                        className="filter-chip"
                        onClick={() => setDraftPatch({ tagIds: draft.tagIds.filter((x) => x !== id) })}
                      >
                        {t?.name ?? id} ×
                      </button>
                    )
                  })}
                  <select className="vault-sort-select" value={draft.tagMode} onChange={(e) => setDraftPatch({ tagMode: e.target.value as MediaFilters['tagMode'] })}>
                    <option value="and">Match all tags</option>
                    <option value="or">Match any tag</option>
                  </select>
                </div>
              ) : null}
              <select className="vault-sort-select" value={draft.resolution ?? ''} onChange={(e) => setDraftPatch({ resolution: (e.target.value || null) as ResolutionPreset | null })}>
                <option value="">Any resolution</option>
                <option value="720">720p+</option>
                <option value="1080">1080p+</option>
                <option value="1440">1440p+</option>
                <option value="2160">4K+</option>
              </select>
              <select
                className="vault-sort-select"
                value={draft.ratingExact != null ? `eq-${draft.ratingExact}` : draft.ratingMin != null ? `min-${draft.ratingMin}` : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) setDraftPatch({ ratingExact: null, ratingMin: null })
                  else if (v.startsWith('eq-')) setDraftPatch({ ratingExact: Number(v.slice(3)), ratingMin: null })
                  else setDraftPatch({ ratingExact: null, ratingMin: Number(v.slice(4)) })
                }}
              >
                <option value="">Any rating</option>
                <option value="min-1">1+ stars</option>
                <option value="min-2">2+ stars</option>
                <option value="min-3">3+ stars</option>
                <option value="min-4">4+ stars</option>
                <option value="min-5">5 stars</option>
                <option value="eq-1">Exactly 1</option>
                <option value="eq-2">Exactly 2</option>
                <option value="eq-3">Exactly 3</option>
                <option value="eq-4">Exactly 4</option>
                <option value="eq-5">Exactly 5</option>
              </select>
              <label className="filter-bar__num">
                Min size (MB)
                <input className="field-input" type="number" min={0} inputMode="decimal" value={draft.sizeMin != null ? Math.round(draft.sizeMin / 1_000_000) : ''} onChange={(e) => setDraftPatch({ sizeMin: e.target.value === '' ? null : Number(e.target.value) * 1_000_000 })} />
              </label>
              <label className="filter-bar__num">
                Max size (MB)
                <input className="field-input" type="number" min={0} inputMode="decimal" value={draft.sizeMax != null ? Math.round(draft.sizeMax / 1_000_000) : ''} onChange={(e) => setDraftPatch({ sizeMax: e.target.value === '' ? null : Number(e.target.value) * 1_000_000 })} />
              </label>
              <label className="filter-bar__num">
                Min duration (s)
                <input className="field-input" type="number" min={0} value={draft.durationMinMs != null ? Math.round(draft.durationMinMs / 1000) : ''} onChange={(e) => setDraftPatch({ durationMinMs: e.target.value === '' ? null : Number(e.target.value) * 1000 })} />
              </label>
              <label className="filter-bar__num">
                Max duration (s)
                <input className="field-input" type="number" min={0} value={draft.durationMaxMs != null ? Math.round(draft.durationMaxMs / 1000) : ''} onChange={(e) => setDraftPatch({ durationMaxMs: e.target.value === '' ? null : Number(e.target.value) * 1000 })} />
              </label>
              <label className="filter-bar__num">
                Uploaded from
                <input className="field-input" type="date" value={draft.uploadedFrom ? draft.uploadedFrom.slice(0, 10) : ''} onChange={(e) => setDraftPatch({ uploadedFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })} />
              </label>
              <label className="filter-bar__num">
                Uploaded to
                <input className="field-input" type="date" value={draft.uploadedTo ? draft.uploadedTo.slice(0, 10) : ''} onChange={(e) => setDraftPatch({ uploadedTo: e.target.value ? `${e.target.value}T23:59:59.999Z` : null })} />
              </label>
              <label className="filter-bar__num">
                Captured from
                <input className="field-input" type="date" value={draft.capturedFrom ? draft.capturedFrom.slice(0, 10) : ''} onChange={(e) => setDraftPatch({ capturedFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })} />
              </label>
              <label className="filter-bar__num">
                Captured to
                <input className="field-input" type="date" value={draft.capturedTo ? draft.capturedTo.slice(0, 10) : ''} onChange={(e) => setDraftPatch({ capturedTo: e.target.value ? `${e.target.value}T23:59:59.999Z` : null })} />
              </label>
            </div>
            <div className="sheet__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setDraft(clearAdvancedFilters(filters))}>
                Clear all
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  onChange({ ...draft, search: filters.search, sort: filters.sort, resultTitle: filters.resultTitle })
                  setOpen(false)
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
