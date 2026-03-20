import type { AlbumWithMeta } from '../../types/album'
import { AlbumCard } from './AlbumCard'

type Props = {
  albums: AlbumWithMeta[]
  busyAlbumIds: ReadonlySet<string>
  onRename: (album: AlbumWithMeta) => void
  onDelete: (album: AlbumWithMeta) => void
  onCreateClick: () => void
}

export function AlbumGrid({
  albums,
  busyAlbumIds,
  onRename,
  onDelete,
  onCreateClick,
}: Props) {
  if (albums.length === 0) {
    return (
      <div className="album-empty album-empty--rich">
        <div className="album-empty__visual" aria-hidden>
          <svg viewBox="0 0 80 80" className="album-empty__svg">
            <rect
              x="12"
              y="18"
              width="56"
              height="44"
              rx="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.35"
            />
            <circle cx="32" cy="36" r="6" fill="currentColor" opacity="0.2" />
            <path
              d="M18 52 L34 38 L46 48 L62 34"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.35"
            />
          </svg>
        </div>
        <h2 className="album-empty__title">No albums yet</h2>
        <p className="album-empty__hint">
          Albums help you organize photos and files—like in Photos or Drive.
        </p>
        <button type="button" className="btn btn--primary album-empty__cta" onClick={onCreateClick}>
          Create your first album
        </button>
      </div>
    )
  }

  return (
    <ul className="album-grid">
      {albums.map((album) => (
        <li key={album.id}>
          <AlbumCard
            album={album}
            busy={busyAlbumIds.has(album.id)}
            onRename={onRename}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  )
}
