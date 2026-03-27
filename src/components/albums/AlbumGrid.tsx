import { useMemo } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AlbumWithMeta } from '../../types/album'
import { AlbumCard } from './AlbumCard'

type Props = {
  albums: AlbumWithMeta[]
  userId: string
  columns: number
  busyAlbumIds: ReadonlySet<string>
  activeAlbumId: string | null
  onOpen: (album: AlbumWithMeta) => void
  onRename: (album: AlbumWithMeta) => void
  onDelete: (album: AlbumWithMeta) => void
  onSetCover?: (album: AlbumWithMeta) => void
  onCreateClick: () => void
  onReorder: (next: AlbumWithMeta[]) => void
}

function SortableAlbumItem({
  album,
  userId,
  busy,
  active,
  onOpen,
  onRename,
  onDelete,
  onSetCover,
}: {
  album: AlbumWithMeta
  userId: string
  busy: boolean
  active: boolean
  onOpen: (album: AlbumWithMeta) => void
  onRename: (album: AlbumWithMeta) => void
  onDelete: (album: AlbumWithMeta) => void
  onSetCover?: (album: AlbumWithMeta) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: album.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.92 : undefined,
    zIndex: isDragging ? 2 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style} className="album-grid__item">
      <AlbumCard
        album={album}
        userId={userId}
        busy={busy}
        active={active}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={onDelete}
        onSetCover={onSetCover}
        dragHandle={
          <button
            type="button"
            className="album-card__drag-handle"
            {...listeners}
            {...attributes}
            aria-label="Drag to reorder album"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="9" cy="7" r="1.35" />
              <circle cx="15" cy="7" r="1.35" />
              <circle cx="9" cy="12" r="1.35" />
              <circle cx="15" cy="12" r="1.35" />
              <circle cx="9" cy="17" r="1.35" />
              <circle cx="15" cy="17" r="1.35" />
            </svg>
          </button>
        }
      />
    </li>
  )
}

export function AlbumGrid({
  albums,
  userId,
  columns,
  busyAlbumIds,
  activeAlbumId,
  onOpen,
  onRename,
  onDelete,
  onSetCover,
  onCreateClick,
  onReorder,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sortableIds = useMemo(() => albums.map((a) => a.id), [albums])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = albums.findIndex((a) => a.id === active.id)
    const newIndex = albums.findIndex((a) => a.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(albums, oldIndex, newIndex)
    onReorder(next)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {albums.length === 0 ? (
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
      ) : (
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          <ul
            className="album-grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
            }}
          >
            {albums.map((album) => (
              <SortableAlbumItem
                key={album.id}
                album={album}
                userId={userId}
                busy={busyAlbumIds.has(album.id)}
                active={activeAlbumId === album.id}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
                onSetCover={onSetCover}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </DndContext>
  )
}
