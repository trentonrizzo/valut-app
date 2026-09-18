import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/useAuth'
import { useVault } from '../../context/useVault'
import { resolveVaultMedia } from '../../lib/media/resolveMedia'
import { isHttpsUrl, isLegacyPublicFile, mediaFragmentUrl } from '../../lib/media/legacyUrl'
import { isVideoFileName } from '../../lib/mediaTypes'

export type VaultPhotoFile = {
  id: string
  file_name: string
  file_url: string
  is_encrypted?: boolean | null
  mime_type?: string | null
  storage_key?: string | null
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
  const [ready, setReady] = useState(false)
  const frameSrc = mediaFragmentUrl(src)

  useEffect(() => {
    setPoster(null)
    setReady(false)
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => {
      setReady(true)
      const dur = v.duration
      const t = dur && Number.isFinite(dur) ? Math.min(0.12, dur * 0.02) : 0.05
      try {
        v.currentTime = t > 0 ? t : 0.05
      } catch {
        /* some browsers reject seek before ready */
      }
    }
    const onSeeked = () => {
      setReady(true)
      if (v.videoWidth < 2 || v.videoHeight < 2) return
      const canvas = document.createElement('canvas')
      const w = Math.min(v.videoWidth, 640)
      const h = Math.round((v.videoHeight / v.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      try {
        ctx.drawImage(v, 0, 0, w, h)
        setPoster(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        /* CORS / tainted — keep the video element as fallback */
      }
    }
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('seeked', onSeeked)
    return () => {
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('seeked', onSeeked)
    }
  }, [frameSrc])

  if (poster) {
    return <img src={poster} alt="" className="vault-photo-tile__thumb-img" />
  }

  return (
    <>
      {!ready ? <div className="vault-photo-tile__media--skeleton" aria-hidden /> : null}
      <video
        ref={videoRef}
        className="vault-photo-tile__thumb-img"
        src={frameSrc}
        muted
        playsInline
        preload="metadata"
        aria-hidden
      />
    </>
  )
}

export function VaultPhotoTileMedia({ file }: Props) {
  const { session } = useAuth()
  const { masterKey } = useVault()
  const isVideo = Boolean(file.mime_type?.startsWith('video/')) || isVideoFileName(file.file_name)
  const token = session?.access_token
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const legacy = isLegacyPublicFile(file)
  const [src, setSrc] = useState<string | null>(null)
  const [variant, setVariant] = useState<'thumb' | 'poster' | 'original'>(
    isVideo ? (file.poster_key ? 'poster' : 'original') : file.thumbnail_key ? 'thumb' : 'original',
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) {
      setVisible(true)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { root: null, rootMargin: '240px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    if (file.file_url?.startsWith('blob:')) {
      setSrc(file.file_url)
      setFailed(false)
      return
    }
    if (legacy && isHttpsUrl(file.file_url)) {
      setSrc(file.file_url)
      setFailed(false)
      setVariant('original')
      return
    }
    if (!token) {
      if (isHttpsUrl(file.file_url)) {
        setSrc(file.file_url)
        setFailed(false)
      }
      return
    }
    let alive = true
    const preferred: 'thumb' | 'poster' | 'original' = isVideo
      ? file.poster_key
        ? 'poster'
        : 'original'
      : file.thumbnail_key
        ? 'thumb'
        : 'original'
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
        setFailed(false)
      })
      .catch(() => {
        if (!alive) return
        if (isHttpsUrl(file.file_url)) {
          setSrc(file.file_url)
          setFailed(false)
        } else {
          setFailed(true)
        }
      })
    return () => {
      alive = false
    }
  }, [visible, file.id, file.file_url, file.poster_key, file.thumbnail_key, file.storage_key, token, masterKey, isVideo, legacy])

  return (
    <div ref={wrapRef} className="vault-photo-tile__media-fill">
      {failed ? (
        <div className="vault-photo-tile__media--failed" aria-label="Could not load media" />
      ) : !src ? (
        <div className="vault-photo-tile__media--skeleton" aria-hidden />
      ) : isVideo && variant === 'original' ? (
        <VideoTilePoster key={src} src={src} />
      ) : (
        <img
          className="vault-photo-tile__thumb-img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            if (src !== file.file_url && isHttpsUrl(file.file_url)) {
              setSrc(file.file_url)
              setVariant('original')
              return
            }
            setFailed(true)
          }}
        />
      )}
    </div>
  )
}
