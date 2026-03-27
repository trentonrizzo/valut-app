import { useEffect, useRef } from 'react'

type Props = {
  src: string
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
    const video = videoRef.current
    const wrap = wrapRef.current
    if (!video || !wrap) return

    const tryPlay = () => {
      void video.play().catch(() => {
        /* first frame + badge still visible */
      })
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

  return (
    <div ref={wrapRef} className="album-card__thumb-video-wrap">
      <video
        ref={videoRef}
        className={className}
        src={src}
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
