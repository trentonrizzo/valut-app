type Props = {
  count: number
  albums: { id: string; name: string }[]
  currentAlbumId?: string | null
  onClear: () => void
  onSelectAll: () => void
  onAddToAlbum: (albumId: string) => void
  onMoveToAlbum?: (albumId: string) => void
  onRemoveFromAlbum?: () => void
  onFavorite: (on: boolean) => void
  onAddTags: () => void
  onRemoveTags: () => void
  onDownload: () => void
}

export function BulkActionBar({
  count,
  albums,
  currentAlbumId,
  onClear,
  onSelectAll,
  onAddToAlbum,
  onMoveToAlbum,
  onRemoveFromAlbum,
  onFavorite,
  onAddTags,
  onRemoveTags,
  onDownload,
}: Props) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-bar__count">{count} selected</span>
      <button type="button" className="btn btn--ghost" onClick={onSelectAll}>
        Select visible
      </button>
      <button type="button" className="btn btn--ghost" onClick={onClear}>
        Clear
      </button>
      <label className="bulk-bar__select">
        Add to album
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAddToAlbum(e.target.value)
            e.target.value = ''
          }}
        >
          <option value="">Choose…</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {onMoveToAlbum && currentAlbumId ? (
        <label className="bulk-bar__select">
          Move to album
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onMoveToAlbum(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">Choose…</option>
            {albums.filter((a) => a.id !== currentAlbumId).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onRemoveFromAlbum && currentAlbumId ? (
        <button type="button" className="btn btn--ghost" onClick={onRemoveFromAlbum}>
          Remove from album
        </button>
      ) : null}
      <button type="button" className="btn btn--ghost" onClick={() => onFavorite(true)}>
        Favorite
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => onFavorite(false)}>
        Unfavorite
      </button>
      <button type="button" className="btn btn--ghost" onClick={onAddTags}>
        Add tags
      </button>
      <button type="button" className="btn btn--ghost" onClick={onRemoveTags}>
        Remove tags
      </button>
      <button type="button" className="btn btn--ghost" onClick={onDownload}>
        Download
      </button>
    </div>
  )
}
