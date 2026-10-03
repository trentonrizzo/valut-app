import { useEffect, useRef } from 'react'
import { browserCapabilities } from '../../lib/browserCapabilities'

type Props = {
  src: string | null
  className?: string
}

/**
 * Muted looping preview; plays while the card is in view (IntersectionObserver).
 * If autoplay is blocked, the first decoded frame still appears under the video badge.
 */
export function AlbumCardCoverVideo({ src, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!src || !browserCapabilities.shouldRenderAnimatedMediaInGrid) return
    const video = videoRef.current
    const wrap = wrapRef.current
    if (!video || !wrap) return

    const tryPlay = () => {
      void video.play().catch(() => {
        /* first frame + badge still visible */
      })
    }

    if (typeof IntersectionObserver === 'undefined') {
      tryPlay()
      return () => video.pause()
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tryPlay()
          else video.pause()
        }
      },
      { root: null, rootMargin: '32px', threshold: 0.2 },
    )

    io.observe(wrap)
    tryPlay()

    return () => {
      io.disconnect()
      video.pause()
    }
  }, [src])

  if (!src) return null

  if (!browserCapabilities.shouldRenderAnimatedMediaInGrid) {
    return <div className="album-card__thumb-video-wrap album-card__thumb-video-wrap--static" aria-label="Video cover">▶</div>
  }

  return (
    <div ref={wrapRef} className="album-card__thumb-video-wrap">
      <video
        ref={videoRef}
        className={className}
        src={src.includes('#') || src.startsWith('blob:') ? src : `${src}#t=0.1`}
        muted
        playsInline
        loop
        autoPlay
        preload="auto"
        aria-hidden
      />
    </div>
  )
}
