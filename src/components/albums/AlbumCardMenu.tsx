import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  albumId: string
  disabled?: boolean
  onRename: () => void
  onSetCover?: () => void
  onDelete: () => void
}

const MENU_Z = 100000

export function AlbumCardMenu({ albumId, disabled, onRename, onSetCover, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return

    const place = () => {
      const btn = btnRef.current
      const menu = menuRef.current
      if (!btn) return

      const rect = btn.getBoundingClientRect()
      const pad = 8
      const estW = menu?.offsetWidth ?? 200
      const estH = menu?.offsetHeight ?? 1

      let left = rect.right - estW
      if (left < pad) left = pad
      if (left + estW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - estW - pad)

      let top = rect.bottom + 6
      if (top + estH > window.innerHeight - pad && rect.top - estH - 6 > pad) {
        top = rect.top - estH - 6
      }
      if (top + estH > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - estH - pad)
      }

      setPos({ top, left })
    }

    place()
    const id = requestAnimationFrame(place)
    return () => cancelAnimationFrame(id)
  }, [open, albumId])

  useEffect(() => {
    if (!open) return
    function closeOnScroll() {
      setOpen(false)
    }
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', closeOnScroll)
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', closeOnScroll)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointer(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer, { passive: true })
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const menu = open ? (
    <div
      ref={menuRef}
      className="album-menu__dropdown album-menu__dropdown--portal"
      id={`album-menu-${albumId}`}
      role="menu"
      aria-labelledby={`album-menu-btn-${albumId}`}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: MENU_Z,
      }}
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
        Rename album
      </button>
      {onSetCover ? (
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
        Delete album
      </button>
    </div>
  ) : null

  return (
    <div className="album-menu">
      <button
        ref={btnRef}
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
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
