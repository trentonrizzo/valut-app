import type { ReactNode } from 'react'
import type { AlbumWithMeta } from '../../types/album'
import { formatBytes } from '../../lib/formatBytes'
import { AlbumCardCoverVideo } from './AlbumCardCoverVideo'
import { AlbumCardMenu } from './AlbumCardMenu'

function formatItemCount(n: number): string {
  if (n === 0) return '0 items'
  if (n === 1) return '1 item'
  return `${n} items`
}

type Props = {
  album: AlbumWithMeta
  busy?: boolean
  active?: boolean
  /** Drag handle (e.g. sortable listeners); clicks do not open the album */
  dragHandle?: ReactNode
  onOpen: (album: AlbumWithMeta) => void
  onRename: (album: AlbumWithMeta) => void
  onDelete: (album: AlbumWithMeta) => void
  onSetCover?: (album: AlbumWithMeta) => void
}

export function AlbumCard({
  album,
  busy,
  active,
  dragHandle,
  onOpen,
  onRename,
  onDelete,
  onSetCover,
}: Props) {
  function openIfNotHandle(e: React.MouseEvent | React.KeyboardEvent) {
    if ('target' in e) {
      const el = e.target as HTMLElement
      if (el.closest('.album-card__drag-slot') || el.closest('.album-menu')) return
    }
    if (!busy) onOpen(album)
  }

  return (
    <article
      className={`album-card album-card--interactive ${busy ? 'album-card--busy' : ''} ${active ? 'album-card--active' : ''}`}
      onClick={(e) => openIfNotHandle(e)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen(album)
        }
      }}
      aria-label={`Open album ${album.name}`}
    >
      <div className="album-card__thumb">
        {dragHandle ? <div className="album-card__drag-slot">{dragHandle}</div> : null}
        {album.previewUrl ? (
          <div className="album-card__thumb-inner album-card__thumb-inner--media">
            {album.previewIsVideo ? (
              <>
                <AlbumCardCoverVideo src={album.previewUrl} className="album-card__thumb-img" />
                <span className="album-card__video-badge" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7L8 5z" />
                  </svg>
                  Video
                </span>
              </>
            ) : (
              <img className="album-card__thumb-img" src={album.previewUrl} alt="" loading="lazy" />
            )}
          </div>
        ) : (
          <div className="album-card__thumb-inner" aria-hidden>
            <svg viewBox="0 0 48 48" className="album-card__icon">
              <rect
                x="6"
                y="10"
                width="36"
                height="28"
                rx="3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M6 18 L16 12 L26 20 L36 14 L42 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
        <AlbumCardMenu
          albumId={album.id}
          disabled={busy}
          onRename={() => onRename(album)}
          onSetCover={onSetCover ? () => onSetCover(album) : undefined}
          onDelete={() => onDelete(album)}
        />
      </div>
      <div className="album-card__body">
        <h2 className="album-card__title" title={album.name}>
          {album.name}
        </h2>
        <div className="album-card__stats" aria-label="Album size and item count">
          <span className="album-card__stats-line">{formatItemCount(album.itemCount)}</span>
          <span className="album-card__stats-line">{formatBytes(album.totalBytes)}</span>
        </div>
      </div>
      {busy ? (
        <div className="album-card__busy" aria-hidden>
          <div className="album-card__busy-spinner" />
        </div>
      ) : null}
    </article>
  )
}
