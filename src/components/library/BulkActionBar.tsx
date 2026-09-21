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
  onRate?: (rating: number | null) => void
  onAddTags: () => void
  onRemoveTags: () => void
  onDownload: () => void
  onDelete?: () => void
  onLock?: () => void
  onUnlock?: () => void
  onSelectAllMatching?: () => void
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
  onRate,
  onAddTags,
  onRemoveTags,
  onDownload,
  onDelete,
  onLock,
  onUnlock,
  onSelectAllMatching,
}: Props) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-bar__count">{count} selected</span>
      <button type="button" className="btn btn--ghost" onClick={onSelectAll}>
        Select visible
      </button>
      {onSelectAllMatching ? (
        <button type="button" className="btn btn--ghost" onClick={onSelectAllMatching}>
          Select all matches
        </button>
      ) : null}
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
      {onRate ? (
        <label className="bulk-bar__select">
          Rating
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return
              onRate(e.target.value === 'none' ? null : Number(e.target.value))
              e.target.value = ''
            }}
          >
            <option value="">Set…</option>
            <option value="none">Clear</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </label>
      ) : null}
      <button type="button" className="btn btn--ghost" onClick={onAddTags}>
        Add tags
      </button>
      <button type="button" className="btn btn--ghost" onClick={onRemoveTags}>
        Remove tags
      </button>
      <button type="button" className="btn btn--ghost" onClick={onDownload}>
        Download
      </button>
      {onLock ? (
        <button type="button" className="btn btn--ghost" onClick={onLock}>
          Lock
        </button>
      ) : null}
      {onUnlock ? (
        <button type="button" className="btn btn--ghost" onClick={onUnlock}>
          Unlock
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="btn btn--ghost" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </div>
  )
}
