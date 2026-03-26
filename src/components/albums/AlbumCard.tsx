import type { AlbumWithMeta } from '../../types/album'
import { AlbumCardMenu } from './AlbumCardMenu'

function formatAlbumDate(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

function formatItemCount(n: number): string {
  if (n === 0) return 'No items'
  if (n === 1) return '1 item'
  return `${n} items`
}

type Props = {
  album: AlbumWithMeta
  busy?: boolean
  active?: boolean
  onOpen: (album: AlbumWithMeta) => void
  onRename: (album: AlbumWithMeta) => void
  onDelete: (album: AlbumWithMeta) => void
}

export function AlbumCard({ album, busy, active, onOpen, onRename, onDelete }: Props) {
  const created = formatAlbumDate(album.created_at)

  return (
    <article
      className={`album-card album-card--interactive ${busy ? 'album-card--busy' : ''} ${active ? 'album-card--active' : ''}`}
      onClick={() => {
        if (!busy) onOpen(album)
      }}
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
        <AlbumCardMenu
          albumId={album.id}
          disabled={busy}
          onRename={() => onRename(album)}
          onDelete={() => onDelete(album)}
        />
      </div>
      <div className="album-card__body">
        <h2 className="album-card__title" title={album.name}>
          {album.name}
        </h2>
        <p className="album-card__count">{formatItemCount(album.itemCount)}</p>
        <p className="album-card__meta">{created}</p>
      </div>
      {busy ? (
        <div className="album-card__busy" aria-hidden>
          <div className="album-card__busy-spinner" />
        </div>
      ) : null}
    </article>
  )
}
