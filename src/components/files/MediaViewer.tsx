import { useCallback, useEffect, useMemo, useRef, useState, type MouseEventHandler, type PointerEventHandler, type WheelEventHandler } from 'react'
import { useDecryptedMediaSrc } from '../../hooks/useDecryptedMediaSrc'

export type MediaFile = {
  id: string
  file_url: string
  file_name: string
  created_at: string
  file_size_bytes?: number | null
  is_encrypted?: boolean | null
}

type Props = {
  open: boolean
  userId: string
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

export function MediaViewer({ open, userId, files, index, onClose, onIndexChange }: Props) {
  const file = files[index]
  const isVideo = file ? isVideoFile(file.file_name) : false

  const displaySrc = useDecryptedMediaSrc(
    file?.file_url ?? null,
    file?.is_encrypted,
    userId,
    file?.file_name ?? '',
    file?.id,
  )

  const mediaSrc = displaySrc ?? (file?.is_encrypted === true ? undefined : file?.file_url)
  const downloadHref = displaySrc ?? (file?.is_encrypted === true ? undefined : file?.file_url)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoLoop, setVideoLoop] = useState(false)
  const [pullDismiss, setPullDismiss] = useState(0)
  const pullDismissRef = useRef(0)

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
  }, [open, isVideo, playbackRate, index, mediaSrc])

  const resetPullDismiss = useCallback(() => {
    pullDismissRef.current = 0
    setPullDismiss(0)
  }, [])

  const goNext = useCallback(() => {
    if (!files.length) return
    setScale(1)
    setPan({ x: 0, y: 0 })
    resetPullDismiss()
    onIndexChange((index + 1) % files.length)
  }, [files.length, index, onIndexChange, resetPullDismiss])

  const goPrev = useCallback(() => {
    if (!files.length) return
    setScale(1)
    setPan({ x: 0, y: 0 })
    resetPullDismiss()
    onIndexChange((index - 1 + files.length) % files.length)
  }, [files.length, index, onIndexChange, resetPullDismiss])

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

  useEffect(() => {
    resetPullDismiss()
  }, [index, open, resetPullDismiss])

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
      if (dy > 0 && Math.abs(dy) >= Math.abs(dx) * 0.55) {
        const p = Math.min(dy, 160)
        pullDismissRef.current = p
        setPullDismiss(p)
      } else {
        pullDismissRef.current = 0
        setPullDismiss(0)
      }
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
        pullDismissRef.current = 0
        setPullDismiss(0)
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
        dragStart.current = { x: e.clientX, y: e.clientY }
        dragDelta.current = { x: 0, y: 0 }
      } else if (dy > 0 && Math.abs(dy) >= Math.abs(dx) * 0.55) {
        const p = Math.min(dy, 160)
        pullDismissRef.current = p
        setPullDismiss(p)
      } else {
        pullDismissRef.current = 0
        setPullDismiss(0)
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
      resetPullDismiss()
      resetDrag()
      return
    }

    if ((isVideo || scale <= 1.0001) && pullDismissRef.current > 52) {
      resetPullDismiss()
      onClose()
      resetDrag()
      return
    }

    const { x: dx, y: dy } = dragDelta.current
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    // Swipe / drag down to close (fallback when pull offset not tracked)
    const dismissDy = 64
    if (
      (isVideo || (scale <= 1.0001 && !pinchingRef.current)) &&
      dy > dismissDy &&
      absY > absX * 1.05
    ) {
      resetPullDismiss()
      onClose()
      resetDrag()
      return
    }

    resetPullDismiss()

    // Horizontal swipe — prev/next
    const hThreshold = 36
    if (absX > hThreshold && absX > absY && (isVideo || !pinchingRef.current)) {
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
      className="media-viewer-backdrop media-viewer-backdrop--open"
      role="presentation"
      onClick={onClose}
      aria-label="Media viewer"
    >
      <div
        className="media-viewer"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          transform: pullDismiss ? `translateY(${pullDismiss}px)` : undefined,
          opacity: pullDismiss ? Math.max(0.5, 1 - pullDismiss / 420) : 1,
        }}
      >
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
                <button
                  type="button"
                  className={`media-viewer__speed-btn ${videoLoop ? 'is-active' : ''}`}
                  onClick={() => setVideoLoop((v) => !v)}
                  aria-pressed={videoLoop}
                  title="Loop video"
                >
                  Loop
                </button>
              </div>
            ) : null}

            <a
              className="btn btn--ghost media-viewer__download"
              href={downloadHref ?? '#'}
              download={file.file_name}
              onClick={(e) => {
                if (!downloadHref) e.preventDefault()
              }}
            >
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
            className={`media-viewer__viewport${isVideo ? ' media-viewer__viewport--video' : ''}`}
            onWheel={isVideo ? undefined : onWheel}
            onPointerDown={isVideo ? undefined : onPointerDown}
            onPointerMove={isVideo ? undefined : onPointerMove}
            onPointerUp={isVideo ? undefined : onPointerUp}
            onPointerCancel={
              isVideo
                ? undefined
                : (e) => {
                    pointerMap.current.delete(e.pointerId)
                    resetPullDismiss()
                    resetDrag()
                  }
            }
            onDoubleClick={onDoubleClick}
          >
            {isVideo ? (
              mediaSrc ? (
                <video
                  key={`${file.id}-${mediaSrc}`}
                  ref={videoRef}
                  className="media-viewer__video"
                  src={mediaSrc}
                  controls
                  loop={videoLoop}
                  playsInline
                  preload="metadata"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div className="media-viewer__loading" aria-busy="true" />
              )
            ) : mediaSrc ? (
              <div key={`${file.id}-${mediaSrc}`} className="media-viewer__image-wrap">
                <img
                  className="media-viewer__image"
                  src={mediaSrc}
                  alt={file.file_name}
                  draggable={false}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transition: scale === 1 ? 'transform 0.18s ease' : 'none',
                  }}
                />
              </div>
            ) : (
              <div className="media-viewer__loading" aria-busy="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

