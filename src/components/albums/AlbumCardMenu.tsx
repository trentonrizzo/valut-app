import { useEffect, useRef, useState } from 'react'

type Props = {
  albumId: string
  disabled?: boolean
  onRename: () => void
  onDelete: () => void
  onSetCover?: () => void
  onRemoveCover?: () => void
  canSetCover: boolean
  hasCustomCover: boolean
}

export function AlbumCardMenu({
  albumId,
  disabled,
  onRename,
  onDelete,
  onSetCover,
  onRemoveCover,
  canSetCover,
  hasCustomCover,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (rootRef.current && !rootRef.current.contains(t)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick, { passive: true })
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className="album-menu" ref={rootRef}>
      <button
        type="button"
        className="album-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={`album-menu-${albumId}`}
        id={`album-menu-btn-${albumId}`}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) setOpen((o) => !o)
        }}
      >
        <span className="album-menu__dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="visually-hidden">Album options</span>
      </button>
      {open ? (
        <div
          className="album-menu__dropdown"
          id={`album-menu-${albumId}`}
          role="menu"
          aria-labelledby={`album-menu-btn-${albumId}`}
        >
          <button
            type="button"
            className="album-menu__item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onRename()
            }}
          >
            Rename
          </button>
          {canSetCover && onSetCover ? (
            <button
              type="button"
              className="album-menu__item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onSetCover()
              }}
            >
              Set album cover
            </button>
          ) : null}
          {hasCustomCover && onRemoveCover ? (
            <button
              type="button"
              className="album-menu__item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onRemoveCover()
              }}
            >
              Remove custom cover
            </button>
          ) : null}
          <button
            type="button"
            className="album-menu__item album-menu__item--danger"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              onDelete()
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}
