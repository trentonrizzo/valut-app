import { useEffect, useRef, useState } from 'react'
import { useDecryptedMediaSrc } from '../../hooks/useDecryptedMediaSrc'
import { isVideoFileName } from '../../lib/mediaTypes'

export type VaultPhotoFile = {
  id: string
  file_name: string
  file_url: string
  is_encrypted?: boolean | null
}

type Props = {
  file: VaultPhotoFile
  userId: string
}

function VideoTilePoster({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [poster, setPoster] = useState<string | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onLoaded = () => {
      const dur = v.duration
      const t = dur && Number.isFinite(dur) ? Math.min(0.12, dur * 0.02) : 0.05
      v.currentTime = t > 0 ? t : 0.05
    }
    const onSeeked = () => {
      if (v.videoWidth < 2 || v.videoHeight < 2) return
      const canvas = document.createElement('canvas')
      const w = Math.min(v.videoWidth, 960)
      const h = Math.round((v.videoHeight / v.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      try {
        ctx.drawImage(v, 0, 0, w, h)
        setPoster(canvas.toDataURL('image/jpeg', 0.88))
      } catch {
        /* CORS / tainted */
      }
    }

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('seeked', onSeeked)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('seeked', onSeeked)
    }
  }, [src])

  if (poster) {
    return <img src={poster} alt="" className="vault-photo-tile__thumb-img" loading="lazy" />
  }

  return (
    <video
      ref={videoRef}
      className="vault-photo-tile__thumb-img"
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden
    />
  )
}

export function VaultPhotoTileMedia({ file, userId }: Props) {
  const { displayUrl, failed } = useDecryptedMediaSrc(
    file.file_url,
    file.is_encrypted,
    userId,
    file.file_name,
    file.id,
  )
  const isVideo = isVideoFileName(file.file_name)

  if (failed || !displayUrl) {
    return (
      <div
        className="vault-photo-tile__media vault-photo-tile__media--failed"
        aria-label="Could not load media"
      />
    )
  }

  return isVideo ? (
    <VideoTilePoster key={displayUrl} src={displayUrl} />
  ) : (
    <img className="vault-photo-tile__thumb-img" src={displayUrl} alt="" loading="lazy" />
  )
}
