import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/useAuth'
import { useVault } from '../../context/useVault'
import { resolveVaultMedia } from '../../lib/media/resolveMedia'
import { isVideoFileName } from '../../lib/mediaTypes'

export type VaultPhotoFile = {
  id: string
  file_name: string
  file_url: string
  is_encrypted?: boolean | null
  mime_type?: string | null
  thumbnail_key?: string | null
  poster_key?: string | null
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
      preload="metadata"
      aria-hidden
    />
  )
}

export function VaultPhotoTileMedia({ file }: Props) {
  const { session } = useAuth()
  const { masterKey } = useVault()
  const isVideo = Boolean(file.mime_type?.startsWith('video/')) || isVideoFileName(file.file_name)
  const token = session?.access_token
  const [src, setSrc] = useState<string | null>(file.file_url?.startsWith('blob:') ? file.file_url : null)
  const [variant, setVariant] = useState<'thumb' | 'poster' | 'original'>(
    isVideo ? (file.poster_key ? 'poster' : 'original') : file.thumbnail_key ? 'thumb' : 'original',
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (file.file_url?.startsWith('blob:')) {
      setSrc(file.file_url)
      return
    }
    if (!token) {
      if (file.file_url && /^https?:\/\//i.test(file.file_url)) setSrc(file.file_url)
      return
    }
    let alive = true
    const preferred = isVideo ? (file.poster_key ? 'poster' : 'original') : file.thumbnail_key ? 'thumb' : 'original'
    resolveVaultMedia({
      fileId: file.id,
      accessToken: token,
      variant: preferred,
      masterKey,
      fallbackUrl: file.file_url,
    })
      .then((r) => {
        if (!alive) return
        setVariant(preferred)
        setSrc(r.displayUrl)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [file.id, file.file_url, file.poster_key, file.thumbnail_key, token, masterKey, isVideo])

  if (failed || !src) {
    return (
      <div
        className="vault-photo-tile__media vault-photo-tile__media--failed"
        aria-label="Could not load media"
      />
    )
  }

  if (isVideo && variant === 'original') {
    return <VideoTilePoster key={src} src={src} />
  }

  return <img className="vault-photo-tile__thumb-img" src={src} alt="" loading="lazy" />
}
