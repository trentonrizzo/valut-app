import type { Database } from '../../types/database'

type AlbumRow = Database['public']['Tables']['albums']['Row']

type Props = {
  album: AlbumRow
}

export function AlbumCard({ album }: Props) {
  const created = new Date(album.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <article className="album-card">
      <div className="album-card__thumb" aria-hidden>
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
      <div className="album-card__body">
        <h2 className="album-card__title">{album.name}</h2>
        <p className="album-card__meta">{created}</p>
      </div>
    </article>
  )
}
