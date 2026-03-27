import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { sortGalleryFiles, type FileSort } from '../lib/gallerySort'
import { isVideoFileName } from '../lib/mediaTypes'
import { useDecryptedMediaSrc } from '../hooks/useDecryptedMediaSrc'

type FileRow = {
  id: string
  user_id: string
  album_id: string
  file_name: string
  file_url: string
  created_at: string
  file_size_bytes?: number | null
  purpose?: string | null
  is_encrypted?: boolean | null
}

function isGalleryFile(f: FileRow): boolean {
  return f.purpose !== 'cover'
}

function isVideo(fileName: string) {
  return isVideoFileName(fileName)
}

/** Bottom area: reserve for native video controls + home indicator */
function isVideoControlsZone(clientY: number): boolean {
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return clientY > h * 0.68
}

function SlideImage({
  file,
  userId,
}: {
  file: FileRow
  userId: string
}) {
  const { displayUrl, failed } = useDecryptedMediaSrc(
    file.file_url,
    file.is_encrypted,
    userId,
    file.file_name,
    file.id,
  )
  if (failed || !displayUrl) {
    return <div className="fs-media-viewer__failed" aria-label="Could not load image" />
  }
  return <img className="fs-media-viewer__photo" src={displayUrl} alt="" draggable={false} />
}

function SlideVideo({
  file,
  userId,
  isActive,
  playbackRate,
  loop,
}: {
  file: FileRow
  userId: string
  isActive: boolean
  playbackRate: number
  loop: boolean
}) {
  const { displayUrl, failed } = useDecryptedMediaSrc(
    file.file_url,
    file.is_encrypted,
    userId,
    file.file_name,
    file.id,
  )
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el || !displayUrl) return
    el.playbackRate = playbackRate
  }, [displayUrl, playbackRate])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !displayUrl) return
    if (isActive) {
      el.loop = loop
      el.muted = false
      void el.play().catch(() => {
        el.muted = true
        void el.play().catch(() => {})
      })
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [isActive, displayUrl, loop])

  if (failed || !displayUrl) {
    return <div className="fs-media-viewer__failed" aria-label="Could not load video" />
  }

  return (
    <div className="fs-media-viewer__video-shell">
      <video
        ref={videoRef}
        className="fs-media-viewer__video"
        src={displayUrl}
        controls
        playsInline
        preload="metadata"
        loop={loop}
      />
    </div>
  )
}

export function FullScreenMediaViewer() {
  const { albumId, fileId } = useParams<{ albumId: string; fileId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const sort = (location.state as { sort?: FileSort } | null)?.sort ?? 'newest'

  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoLoop, setVideoLoop] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [slideW, setSlideW] = useState(0)

  const [dragX, setDragX] = useState(0)
  const [dragY, setDragY] = useState(0)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, mode: 'none' as 'none' | 'h' | 'v' })

  const displayFiles = useMemo(() => sortGalleryFiles(files, sort), [files, sort])

  const index = useMemo(() => {
    if (!fileId) return -1
    return displayFiles.findIndex((f) => f.id === fileId)
  }, [displayFiles, fileId])

  const currentFile = index >= 0 ? displayFiles[index] : null
  const currentIsVideo = currentFile ? isVideo(currentFile.file_name) : false

  const { downloadUrl: downloadHref } = useDecryptedMediaSrc(
    currentFile?.file_url ?? null,
    currentFile?.is_encrypted,
    user?.id ?? null,
    currentFile?.file_name ?? '',
    currentFile?.id,
  )

  useEffect(() => {
    if (!user || !albumId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: qError } = await supabase
          .from('files')
          .select('*')
          .eq('album_id', albumId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        if (cancelled) return
        if (qError) throw new Error(qError.message)
        const rows = ((data as FileRow[]) ?? []).filter(isGalleryFile)
        setFiles(rows)
        if (fileId && !rows.some((r) => r.id === fileId)) {
          navigate(`/albums/${albumId}`, { replace: true })
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load')
          setFiles([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, albumId, fileId, navigate])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSlideW(el.clientWidth))
    ro.observe(el)
    setSlideW(el.clientWidth)
    return () => ro.disconnect()
  }, [loading])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const goClose = useCallback(() => {
    if (!albumId) return
    navigate(`/albums/${albumId}`, { state: location.state })
  }, [albumId, navigate, location.state])

  const goToIndex = useCallback(
    (next: number) => {
      if (!albumId || displayFiles.length === 0) return
      const clamped = Math.max(0, Math.min(displayFiles.length - 1, next))
      const f = displayFiles[clamped]
      if (!f) return
      navigate(`/albums/${albumId}/media/${f.id}`, {
        replace: true,
        state: location.state,
      })
    },
    [albumId, displayFiles, navigate, location.state],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goClose()
      if (e.key === 'ArrowLeft') goToIndex(index - 1)
      if (e.key === 'ArrowRight') goToIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goClose, goToIndex, index])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (!t.closest('.fs-media-viewer__chrome') && menuOpen) setMenuOpen(false)
    if (t.closest('.fs-media-viewer__chrome')) return
    const vid = t.closest('video')
    if (vid && isVideoControlsZone(e.clientY)) return

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'none',
    }
    setIsDragging(true)
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    if (d.mode === 'none' && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      const vid = (e.target as HTMLElement).closest?.('video')
      const blockH = Boolean(vid && isVideoControlsZone(e.clientY) && Math.abs(dx) > Math.abs(dy))
      if (blockH) {
        d.mode = 'v'
      } else if (Math.abs(dx) > Math.abs(dy)) {
        d.mode = 'h'
      } else {
        d.mode = 'v'
      }
    }

    if (d.mode === 'h') {
      let x = dx
      if (index <= 0 && x > 0) x *= 0.35
      if (index >= displayFiles.length - 1 && x < 0) x *= 0.35
      setDragX(x)
      setDragY(0)
    } else if (d.mode === 'v') {
      const y = Math.max(0, dy)
      setDragY(y)
      setDragX(0)
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    setIsDragging(false)
    try {
      stageRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    if (d.mode === 'h' && slideW > 0) {
      if (dx < -52) goToIndex(index + 1)
      else if (dx > 52) goToIndex(index - 1)
    } else if (d.mode === 'v' && dy > 64 && Math.abs(dy) > Math.abs(dx) * 0.55) {
      goClose()
    }

    setDragX(0)
    setDragY(0)
    d.mode = 'none'
  }

  const trackOffset = useMemo(() => {
    if (slideW <= 0 || index < 0) return 0
    return -index * slideW + dragX
  }, [slideW, index, dragX])

  const dismissStyle = dragY > 0 ? { transform: `translateY(${dragY}px)`, opacity: Math.max(0.35, 1 - dragY / 420) } : undefined

  if (!albumId || !fileId) return null

  if (loading) {
    return (
      <div className="fs-media-viewer fs-media-viewer--loading">
        <div className="fs-media-viewer__loading" aria-busy />
      </div>
    )
  }

  if (error || !currentFile || index < 0) {
    return (
      <div className="fs-media-viewer fs-media-viewer--loading">
        <p className="fs-media-viewer__err">{error ?? 'Not found'}</p>
        <button type="button" className="btn btn--primary" onClick={goClose}>
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="fs-media-viewer" style={dismissStyle}>
      <header className="fs-media-viewer__chrome">
        <button type="button" className="fs-media-viewer__icon-btn" onClick={goClose} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="fs-media-viewer__filename" title={currentFile.file_name}>
          {currentFile.file_name}
        </span>
        <div className="fs-media-viewer__chrome-right">
          <button
            type="button"
            className="fs-media-viewer__icon-btn"
            aria-label="More"
            aria-expanded={menuOpen}
            onClick={(ev) => {
              ev.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div
              className="fs-media-viewer__menu"
              role="menu"
              onPointerDown={(ev) => ev.stopPropagation()}
            >
              {currentIsVideo ? (
                <>
                  <div className="fs-media-viewer__menu-label">Speed</div>
                  <div className="fs-media-viewer__menu-row">
                    {[0.5, 1, 1.5, 2].map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`fs-media-viewer__chip ${playbackRate === r ? 'is-on' : ''}`}
                        onClick={() => {
                          setPlaybackRate(r)
                          setMenuOpen(false)
                        }}
                      >
                        {r}x
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="fs-media-viewer__menu-item"
                    onClick={() => {
                      setVideoLoop((x) => !x)
                      setMenuOpen(false)
                    }}
                  >
                    Loop: {videoLoop ? 'On' : 'Off'}
                  </button>
                </>
              ) : null}
              <a
                className="fs-media-viewer__menu-item"
                href={downloadHref ?? '#'}
                download={currentFile.file_name}
                onClick={(ev) => {
                  if (!downloadHref) ev.preventDefault()
                  setMenuOpen(false)
                }}
              >
                Download
              </a>
            </div>
          ) : null}
        </div>
      </header>

      <div
        ref={stageRef}
        className="fs-media-viewer__stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="presentation"
      >
        <div
          className="fs-media-viewer__track"
          style={{
            width: slideW > 0 ? `${displayFiles.length * slideW}px` : undefined,
            transform: `translate3d(${trackOffset}px, 0, 0)`,
            transition: isDragging ? 'none' : 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {displayFiles.map((f, i) => {
            const vid = isVideo(f.file_name)
            return (
              <div key={f.id} className="fs-media-viewer__slide" style={{ width: slideW > 0 ? slideW : '100%' }}>
                {user ? (
                  vid ? (
                    <SlideVideo
                      file={f}
                      userId={user.id}
                      isActive={i === index}
                      playbackRate={playbackRate}
                      loop={videoLoop}
                    />
                  ) : (
                    <SlideImage file={f} userId={user.id} />
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="fs-media-viewer__counter" aria-hidden>
        {index + 1} / {displayFiles.length}
      </div>
    </div>
  )
}
