import { useCallback, useEffect, useMemo, useRef, useState, type MouseEventHandler, type PointerEventHandler, type WheelEventHandler } from 'react'

export type MediaFile = {
  id: string
  file_url: string
  file_name: string
  created_at: string
}

type Props = {
  open: boolean
  files: MediaFile[]
  index: number
  onClose: () => void
  onIndexChange: (nextIndex: number) => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isVideoFile(fileName: string) {
  const lower = String(fileName || '').toLowerCase()
  return /\.(mp4|webm|ogg|mov|mkv)$/i.test(lower)
}

export function MediaViewer({ open, files, index, onClose, onIndexChange }: Props) {
  const file = files[index]
  const isVideo = file ? isVideoFile(file.file_name) : false

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [playbackRate, setPlaybackRate] = useState(1)

  // Image zoom/pan state (only used for images)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const pointerMap = useRef(new Map<number, { x: number; y: number }>())
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const dragDelta = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pinchPrevDist = useRef<number | null>(null)
  const pinchingRef = useRef(false)

  const maxScale = 5
  const minScale = 1

  const canNavigate = useMemo(() => {
    // When zoomed, drag is for panning, not switching files.
    return !isVideo && scale <= 1.0001
  }, [isVideo, scale])

  useEffect(() => {
    if (!open) return

    // Lock scroll so the viewer behaves like a proper full-screen overlay.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open || !isVideo) return
    const el = videoRef.current
    if (!el) return

    el.playbackRate = playbackRate
    // Autoplay when opened. Some browsers require user gesture; we still attempt.
    void el.play().catch(() => {})
  }, [open, isVideo, playbackRate, index])

  const goNext = useCallback(() => {
    if (!files.length) return
    setScale(1)
    setPan({ x: 0, y: 0 })
    onIndexChange((index + 1) % files.length)
  }, [files.length, index, onIndexChange])

  const goPrev = useCallback(() => {
    if (!files.length) return
    setScale(1)
    setPan({ x: 0, y: 0 })
    onIndexChange((index - 1 + files.length) % files.length)
  }, [files.length, index, onIndexChange])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, goPrev, goNext])

  const onWheel: WheelEventHandler<HTMLDivElement> = (e) => {
    if (!file || isVideo) return
    e.preventDefault()

    const delta = -e.deltaY
    const factor = delta > 0 ? 1.08 : 0.925

    setScale((prev) => clamp(prev * factor, minScale, maxScale))
  }

  const resetDrag = () => {
    dragStart.current = null
    dragDelta.current = { x: 0, y: 0 }
  }

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (e) => {
    if (!file) return
    if (!viewportRef.current) return

    viewportRef.current.setPointerCapture(e.pointerId)
    pointerMap.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (isVideo) {
      pinchingRef.current = false
      dragStart.current = { x: e.clientX, y: e.clientY }
      dragDelta.current = { x: 0, y: 0 }
      return
    }

    if (pointerMap.current.size === 2) {
      const pts = Array.from(pointerMap.current.values())
      pinchPrevDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      pinchingRef.current = true
      resetDrag()
    } else if (pointerMap.current.size === 1) {
      pinchingRef.current = false
      dragStart.current = { x: e.clientX, y: e.clientY }
      dragDelta.current = { x: 0, y: 0 }
    }
  }

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (e) => {
    if (!file) return
    if (!pointerMap.current.has(e.pointerId)) return

    pointerMap.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (isVideo) {
      const start = dragStart.current
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      dragDelta.current = { x: dx, y: dy }
      return
    }

    const pts = Array.from(pointerMap.current.values())

    // Pinch zoom (two touches)
    if (pts.length === 2) {
      const [a, b] = pts
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const prev = pinchPrevDist.current

      if (prev && prev > 0) {
        const ratio = dist / prev
        setScale((s) => clamp(s * ratio, minScale, maxScale))
      }

      pinchPrevDist.current = dist
      resetDrag()
      return
    }

    // Single pointer: pan when zoomed, swipe when not.
    if (pts.length === 1) {
      const start = dragStart.current
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      dragDelta.current = { x: dx, y: dy }

      if (scale > 1.01) {
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
        dragStart.current = { x: e.clientX, y: e.clientY }
        dragDelta.current = { x: 0, y: 0 }
      }
    }
  }

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (e) => {
    if (!file) return

    pointerMap.current.delete(e.pointerId)

    pinchPrevDist.current = null
    if (pointerMap.current.size < 2) pinchingRef.current = false

    const start = dragStart.current
    if (!start) return

    if (!isVideo && !canNavigate) {
      resetDrag()
      return
    }

    const { x: dx, y: dy } = dragDelta.current
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    // Horizontal swipe threshold
    if (absX > 70 && absX > absY && (isVideo || !pinchingRef.current)) {
      if (dx < 0) goNext()
      else goPrev()
    }

    resetDrag()
  }

  const onDoubleClick: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!file || isVideo) return
    e.preventDefault()
    setPan({ x: 0, y: 0 })
    setScale((prev) => (prev > 1.01 ? 1 : 2.75))
  }

  if (!open) return null
  if (!file) return null

  return (
    <div
      className="media-viewer-backdrop"
      role="presentation"
      onClick={onClose}
      aria-label="Media viewer"
    >
      <div className="media-viewer" role="dialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
        <div className="media-viewer__topbar">
          <div className="media-viewer__title">
            <div className="media-viewer__filename" title={file.file_name}>
              {file.file_name}
            </div>
          </div>

          <div className="media-viewer__actions">
            {isVideo ? (
              <div className="media-viewer__speed">
                {[0.5, 1, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`media-viewer__speed-btn ${Math.abs(playbackRate - r) < 0.01 ? 'is-active' : ''}`}
                    onClick={() => setPlaybackRate(r)}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            ) : null}

            <a className="btn btn--ghost media-viewer__download" href={file.file_url} download>
              Download
            </a>
            <button type="button" className="btn btn--ghost media-viewer__close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="media-viewer__content">
          {files.length > 1 ? (
            <button
              type="button"
              className="media-viewer__nav media-viewer__nav--prev"
              onClick={goPrev}
              aria-label="Previous file"
            >
              ‹
            </button>
          ) : null}

          {files.length > 1 ? (
            <button
              type="button"
              className="media-viewer__nav media-viewer__nav--next"
              onClick={goNext}
              aria-label="Next file"
            >
              ›
            </button>
          ) : null}

          <div
            ref={viewportRef}
            className="media-viewer__viewport"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            {isVideo ? (
              <video
                key={file.id}
                ref={videoRef}
                className="media-viewer__video"
                src={file.file_url}
                controls
                autoPlay
                playsInline
                preload="metadata"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div key={file.id} className="media-viewer__image-wrap">
                <img
                  className="media-viewer__image"
                  src={file.file_url}
                  alt={file.file_name}
                  draggable={false}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transition: scale === 1 ? 'transform 0.18s ease' : 'none',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

