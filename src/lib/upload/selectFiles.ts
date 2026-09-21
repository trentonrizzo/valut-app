import { extOf, isVideoUpload, normalizeUploadMime } from './strategy'

export type SelectedUpload = {
  file: File
  name: string
  size: number
  type: string
  extension: string
  lastModified: number
  isVideo: boolean
}

export function inspectSelectedFile(file: File): SelectedUpload {
  const type = normalizeUploadMime(file)
  return {
    file,
    name: file.name,
    size: file.size,
    type,
    extension: extOf(file.name),
    lastModified: file.lastModified,
    isVideo: isVideoUpload(file),
  }
}

export function filesFromInput(list: FileList | null | undefined): File[] {
  if (!list || list.length === 0) return []
  return Array.from(list)
}

/** Why a Photos/Safari confirm produced nothing usable. */
export function selectionFailureReason(files: File[]): string | null {
  if (files.length === 0) {
    return 'Safari did not hand over a file. If this video is in iCloud, open Photos, download it to this iPhone, then select it again.'
  }
  const empty = files.filter((f) => !f || f.size <= 0)
  if (empty.length === files.length) {
    return `The selected file is empty (${empty[0]?.name || 'unnamed'}). iCloud-only items must be downloaded on this iPhone before Vault can upload them.`
  }
  return null
}

export function logUploadSelection(stage: string, extra: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return
  console.info(`[vault-upload] ${stage}`, extra)
}
