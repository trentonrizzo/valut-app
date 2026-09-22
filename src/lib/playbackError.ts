export type PlaybackFailureKind =
  | 'network'
  | 'authorization'
  | 'missing'
  | 'decrypt'
  | 'decode'
  | 'unsupported_format'
  | 'unknown'

const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export function classifyResolveFailure(error: unknown): PlaybackFailureKind {
  const msg = error instanceof Error ? error.message : String(error || '')
  const lower = msg.toLowerCase()
  if (/decrypt|unwrap|master key|recovery key|wrapped.?dek|encryption/i.test(msg)) return 'decrypt'
  if (/401|403|invalid or expired|authorization|forbidden/i.test(lower)) return 'authorization'
  if (/404|no storage object|not found|missing/i.test(lower)) return 'missing'
  if (/failed to fetch|network|load|signed-get|timeout/i.test(lower)) return 'network'
  return 'network'
}

export function classifyVideoElementError(el: { error?: { code?: number; message?: string } | null } | null): PlaybackFailureKind {
  const code = el?.error?.code
  const msg = String(el?.error?.message || '').toLowerCase()
  if (code === MEDIA_ERR_NETWORK) return 'network'
  if (code === MEDIA_ERR_DECODE) return 'decode'
  if (code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    if (/403|401|denied|unauthorized|forbidden/.test(msg)) return 'authorization'
    if (/404|not found|no such/.test(msg)) return 'missing'
    if (/net::|failed to load|network/.test(msg)) return 'network'
    // Code 4 is also used for HTTP failures on some browsers. Do not assume codec.
    if (/format|codec|decode|unsupported|not supported/.test(msg)) return 'unsupported_format'
    return 'network'
  }
  if (code === MEDIA_ERR_ABORTED) return 'unknown'
  return 'unknown'
}

export function playbackFailureMessage(kind: PlaybackFailureKind): string {
  switch (kind) {
    case 'network':
      return 'Could not load this video (network or signed URL). The original is still stored.'
    case 'authorization':
      return 'Could not authorize playback. Try again. The original is still stored.'
    case 'missing':
      return 'This video could not be found in storage. The original record is still kept.'
    case 'decrypt':
      return 'Could not decrypt this video. Unlock your vault key and try again. The original is still stored.'
    case 'decode':
    case 'unsupported_format':
      return 'This device cannot play this video format. The original is still stored.'
    default:
      return 'This video could not be played. The original is still stored.'
  }
}

/** Omit a forced type for .mov so Safari sniffs the response Content-Type. */
export function videoSourceType(fileName: string, mimeType?: string | null): string | undefined {
  const name = String(fileName || '').toLowerCase()
  const mime = (mimeType || '').trim().toLowerCase()
  if (name.endsWith('.mov') || name.endsWith('.qt') || mime === 'video/quicktime') return undefined
  if (mime.startsWith('video/')) return mime
  return undefined
}
