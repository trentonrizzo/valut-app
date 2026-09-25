import { useState } from 'react'

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
  onDetails?: () => void
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
  onDetails,
}: Props) {
  const [more, setMore] = useState(false)
  if (count === 0) return null
  return (
    <>
      <div className="bulk-bar bulk-bar--compact" role="toolbar" aria-label="Selection actions">
        <span className="bulk-bar__count">{count} selected</span>
        <label className="bulk-bar__select">
          Add
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onAddToAlbum(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">Add…</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {onMoveToAlbum && currentAlbumId ? (
          <label className="bulk-bar__select">
            Move
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onMoveToAlbum(e.target.value)
                e.target.value = ''
              }}
            >
              <option value="">Move…</option>
              {albums
                .filter((a) => a.id !== currentAlbumId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {onDelete ? (
          <button type="button" className="btn btn--ghost" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost" onClick={() => setMore(true)} aria-label="More actions">
          •••
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      {more ? (
        <div className="sheet-root">
          <button type="button" className="sheet-backdrop" aria-label="Close actions" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="More selection actions">
            <div className="sheet__handle" />
            <h2 className="sheet__title">{count} selected</h2>
            <div className="sheet__stack">
              <button type="button" className="btn btn--outline" onClick={onSelectAll}>
                Select visible
              </button>
              {onSelectAllMatching ? (
                <button type="button" className="btn btn--outline" onClick={onSelectAllMatching}>
                  Select all matches
                </button>
              ) : null}
              {onRemoveFromAlbum && currentAlbumId ? (
                <button type="button" className="btn btn--outline" onClick={onRemoveFromAlbum}>
                  Remove from album
                </button>
              ) : null}
              <button type="button" className="btn btn--outline" onClick={() => onFavorite(true)}>
                Favorite
              </button>
              {onDetails && count === 1 ? (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => {
                    setMore(false)
                    onDetails()
                  }}
                >
                  Details
                </button>
              ) : null}
              <button type="button" className="btn btn--outline" onClick={() => onFavorite(false)}>
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
              <button type="button" className="btn btn--outline" onClick={onAddTags}>
                Add tags
              </button>
              <button type="button" className="btn btn--outline" onClick={onRemoveTags}>
                Remove tags
              </button>
              <button type="button" className="btn btn--outline" onClick={onDownload}>
                Download
              </button>
              {onLock ? (
                <button type="button" className="btn btn--outline" onClick={onLock}>
                  Lock
                </button>
              ) : null}
              {onUnlock ? (
                <button type="button" className="btn btn--outline" onClick={onUnlock}>
                  Unlock
                </button>
              ) : null}
            </div>
            <div className="sheet__actions">
              <button type="button" className="btn btn--primary" onClick={() => setMore(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
