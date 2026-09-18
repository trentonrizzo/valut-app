import type { MediaFilters, MediaSort, ResolutionPreset } from '../../types/media'

type Props = {
  filters: MediaFilters
  onChange: (next: MediaFilters) => void
  tags: { id: string; name: string }[]
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

export function FilterBar({ filters, onChange, tags }: Props) {
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
        value={filters.tagIds[0] ?? ''}
        onChange={(e) => set({ tagIds: e.target.value ? [e.target.value, ...filters.tagIds.filter((id) => id !== e.target.value)] : [] })}
      >
        <option value="">Any tag</option>
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
      <label className="filter-bar__check">
        <input type="checkbox" checked={filters.noAlbum} onChange={(e) => set({ noAlbum: e.target.checked, albumId: e.target.checked ? null : filters.albumId })} />
        No album
      </label>
    </div>
  )
}
