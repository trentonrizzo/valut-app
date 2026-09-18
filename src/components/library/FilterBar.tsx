import type { MediaFilters, MediaSort, ResolutionPreset } from '../../types/media'

type Props = {
  filters: MediaFilters
  onChange: (next: MediaFilters) => void
  tags: { id: string; name: string }[]
  albums?: { id: string; name: string }[]
}

const SORTS: { id: MediaSort; label: string }[] = [
  { id: 'newest_upload', label: 'Newest upload' },
  { id: 'oldest_upload', label: 'Oldest upload' },
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
  const set = (patch: Partial<MediaFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className="filter-bar">
      <input
        className="field-input filter-bar__search"
        placeholder="Search filename or tags"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <select className="vault-sort-select" value={filters.type} onChange={(e) => set({ type: e.target.value as MediaFilters['type'] })}>
        <option value="all">All types</option>
        <option value="photos">Photos</option>
        <option value="videos">Videos</option>
      </select>
      <select className="vault-sort-select" value={filters.sort} onChange={(e) => set({ sort: e.target.value as MediaSort })}>
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        className="vault-sort-select"
        value={filters.favorite}
        onChange={(e) => set({ favorite: e.target.value as MediaFilters['favorite'] })}
      >
        <option value="all">All</option>
        <option value="yes">Favorites</option>
        <option value="no">Not favorited</option>
      </select>
      <select
        className="vault-sort-select"
        value={filters.albumId ?? (filters.noAlbum ? '__none__' : '')}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__none__') set({ albumId: null, noAlbum: true })
          else if (!v) set({ albumId: null, noAlbum: false })
          else set({ albumId: v, noAlbum: false })
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
          if (filters.tagIds.includes(id)) return
          set({ tagIds: [...filters.tagIds, id] })
        }}
      >
        <option value="">Add tag filter</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {filters.tagIds.length > 0 ? (
        <div className="filter-bar__tags">
          {filters.tagIds.map((id) => {
            const t = tags.find((x) => x.id === id)
            return (
              <button
                key={id}
                type="button"
                className="filter-chip"
                onClick={() => set({ tagIds: filters.tagIds.filter((x) => x !== id) })}
              >
                {t?.name ?? id} ×
              </button>
            )
          })}
          <select
            className="vault-sort-select"
            value={filters.tagMode}
            onChange={(e) => set({ tagMode: e.target.value as MediaFilters['tagMode'] })}
          >
            <option value="and">Match all tags</option>
            <option value="or">Match any tag</option>
          </select>
        </div>
      ) : null}
      <select
        className="vault-sort-select"
        value={filters.resolution ?? ''}
        onChange={(e) => set({ resolution: (e.target.value || null) as ResolutionPreset | null })}
      >
        <option value="">Any resolution</option>
        <option value="720">720p+</option>
        <option value="1080">1080p+</option>
        <option value="1440">1440p+</option>
        <option value="2160">4K+</option>
      </select>
      <select
        className="vault-sort-select"
        value={filters.ratingExact != null ? `eq-${filters.ratingExact}` : filters.ratingMin != null ? `min-${filters.ratingMin}` : ''}
        onChange={(e) => {
          const v = e.target.value
          if (!v) set({ ratingExact: null, ratingMin: null })
          else if (v.startsWith('eq-')) set({ ratingExact: Number(v.slice(3)), ratingMin: null })
          else set({ ratingExact: null, ratingMin: Number(v.slice(4)) })
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
        <input
          className="field-input"
          type="number"
          min={0}
          inputMode="decimal"
          value={filters.sizeMin != null ? Math.round(filters.sizeMin / 1_000_000) : ''}
          onChange={(e) => set({ sizeMin: e.target.value === '' ? null : Number(e.target.value) * 1_000_000 })}
        />
      </label>
      <label className="filter-bar__num">
        Max size (MB)
        <input
          className="field-input"
          type="number"
          min={0}
          inputMode="decimal"
          value={filters.sizeMax != null ? Math.round(filters.sizeMax / 1_000_000) : ''}
          onChange={(e) => set({ sizeMax: e.target.value === '' ? null : Number(e.target.value) * 1_000_000 })}
        />
      </label>
      <label className="filter-bar__num">
        Min duration (s)
        <input
          className="field-input"
          type="number"
          min={0}
          value={filters.durationMinMs != null ? Math.round(filters.durationMinMs / 1000) : ''}
          onChange={(e) => set({ durationMinMs: e.target.value === '' ? null : Number(e.target.value) * 1000 })}
        />
      </label>
      <label className="filter-bar__num">
        Max duration (s)
        <input
          className="field-input"
          type="number"
          min={0}
          value={filters.durationMaxMs != null ? Math.round(filters.durationMaxMs / 1000) : ''}
          onChange={(e) => set({ durationMaxMs: e.target.value === '' ? null : Number(e.target.value) * 1000 })}
        />
      </label>
      <label className="filter-bar__num">
        Uploaded from
        <input
          className="field-input"
          type="date"
          value={filters.uploadedFrom ? filters.uploadedFrom.slice(0, 10) : ''}
          onChange={(e) => set({ uploadedFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
        />
      </label>
      <label className="filter-bar__num">
        Uploaded to
        <input
          className="field-input"
          type="date"
          value={filters.uploadedTo ? filters.uploadedTo.slice(0, 10) : ''}
          onChange={(e) => set({ uploadedTo: e.target.value ? `${e.target.value}T23:59:59.999Z` : null })}
        />
      </label>
      <label className="filter-bar__num">
        Captured from
        <input
          className="field-input"
          type="date"
          value={filters.capturedFrom ? filters.capturedFrom.slice(0, 10) : ''}
          onChange={(e) => set({ capturedFrom: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
        />
      </label>
      <label className="filter-bar__num">
        Captured to
        <input
          className="field-input"
          type="date"
          value={filters.capturedTo ? filters.capturedTo.slice(0, 10) : ''}
          onChange={(e) => set({ capturedTo: e.target.value ? `${e.target.value}T23:59:59.999Z` : null })}
        />
      </label>
    </div>
  )
}
