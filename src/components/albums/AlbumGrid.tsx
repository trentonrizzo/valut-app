import type { Database } from '../../types/database'
import { AlbumCard } from './AlbumCard'

type AlbumRow = Database['public']['Tables']['albums']['Row']

type Props = {
  albums: AlbumRow[]
}

export function AlbumGrid({ albums }: Props) {
  if (albums.length === 0) {
    return (
      <div className="album-empty">
        <p>No albums yet.</p>
        <p className="album-empty__hint">Create your first album to get started.</p>
      </div>
    )
  }

  return (
    <ul className="album-grid">
      {albums.map((album) => (
        <li key={album.id}>
          <AlbumCard album={album} />
        </li>
      ))}
    </ul>
  )
}
