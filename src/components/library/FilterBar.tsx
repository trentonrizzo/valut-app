import { useEffect, useState } from 'react'
import type { MediaFilters, MediaSort, ResolutionPreset } from '../../types/media'
import { advancedFilterCount, clearAdvancedFilters } from '../../lib/libraryFilters'

type Props = {
  filters: MediaFilters
  onChange: (next: MediaFilters) => void
  tags: { id: string; name: string }[]
  albums?: { id: string; name: string }[]
}

const SORTS: { id: MediaSort; label: string }[] = [
  { id: 'newest_upload', label: 'Newest' },
  { id: 'oldest_upload', label: 'Oldest' },
  { id: 'newest_captured', label: 'Newest captured' },
  { id: 'oldest_captured', label: 'Oldest captured' },
  { id: 'largest', label: 'Largest' },
  { id: 'smallest', label: 'Smallest' },
  { id: 'longest', label: 'Longest' },
  { id: 'shortest', label: 'Shortest' },
  { id: 'highest_res', label: 'Highest resolution' },
  { id: 'lowest_res', label: 'Lowest resolution' },
  { id: 'highest_rating', label: 'Highest rating' },
  { id: 'favorites_first', label: 'Favorites first' },
]

export function FilterBar({ filters, onChange, tags, albums = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filters)
  const count = advancedFilterCount(filters)

  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const setDraftPatch = (patch: Partial<MediaFilters>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <div className="library-controls">
      <input
        className="field-input filter-bar__search"
        placeholder="Search photos, videos, files..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        aria-label="Search library"
      />
      <div className="library-controls__row">
        <button type="button" className="btn btn--outline" onClick={() => setOpen(true)}>
          {count > 0 ? `Filters (${count})` : 'Filters'}
        </button>
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
          <div className="sheet" role="dialog" aria-label="Library filters">
            <div className="sheet__handle" />
            <h2 className="sheet__title">Filters</h2>
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
                  onChange({ ...draft, search: filters.search, sort: filters.sort })
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
