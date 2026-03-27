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

export function VaultPhotoTileMedia({ file, userId }: Props) {
  const src = useDecryptedMediaSrc(
    file.file_url,
    file.is_encrypted,
    userId,
    file.file_name,
    file.id,
  )
  const displaySrc = src ?? (file.is_encrypted === true ? undefined : file.file_url)
  const isVideo = isVideoFileName(file.file_name)

  if (!displaySrc) {
    return <div className="vault-photo-tile__media vault-photo-tile__media--pending" aria-hidden />
  }

  return isVideo ? (
    <video src={displaySrc} muted playsInline preload="metadata" />
  ) : (
    <img src={displaySrc} alt="" loading="lazy" />
  )
}
