/** Pure PIN and capture-date rules. No I/O and no secrets. */

export const PIN_DOTS = 6

export function normalizePin(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(0, PIN_DOTS)
}

export function pinSetupAllowed(pin: string, acceptedShortPin: boolean): { ok: boolean; warning: boolean; reason: string | null } {
  const digits = String(pin || '')
  if (!/^[0-9]{1,6}$/.test(digits)) return { ok: false, warning: false, reason: 'Use 1 to 6 digits.' }
  const value = digits
  if (value.length < 6 && !acceptedShortPin) {
    return { ok: false, warning: true, reason: 'Pins shorter than 6 digits are much easier to guess.' }
  }
  return { ok: true, warning: value.length < 6, reason: null }
}

/** Seconds the server should refuse new guesses after this failure count. */
export function lockoutSecondsAfterFailure(failCount: number): number {
  if (failCount >= 10) return 2 * 60 * 60
  if (failCount >= 8) return 30 * 60
  if (failCount >= 5) return 5 * 60
  if (failCount >= 3) return 30
  return 0
}

export function genericPinFailure(): string {
  return 'Incorrect PIN'
}

export type CaptureConfidence = 'high' | 'medium' | 'low' | 'fallback' | 'unknown'

export function captureConfidence(source: string | null | undefined, hasOffset: boolean): CaptureConfidence {
  switch (source) {
    case 'exif_datetime_original':
    case 'exif_create_date':
      return hasOffset ? 'high' : 'medium'
    case 'xmp_date_created':
    case 'quicktime_day':
      return hasOffset ? 'high' : 'medium'
    case 'quicktime_mvhd':
      return 'medium'
    case 'filename_inferred':
      return 'low'
    case 'file_last_modified':
      return 'fallback'
    case 'user_entered':
      return 'high'
    default:
      return 'unknown'
  }
}

export function originalCreatedLabel(source: string | null | undefined): string {
  if (source === 'file_last_modified') return 'Unknown'
  if (source === 'filename_inferred') return 'Inferred from filename'
  return 'Original Created'
}

/** Lower-confidence filename dates. Never treated as embedded capture metadata. */
export function inferFilenameCapture(name: string): { local: string } | null {
  const base = String(name || '')
  const stamped = base.match(/(?:IMG|VID|MOV|PXL|DSC|PHOTO)[_-]?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/i)
    || base.match(/(^|[^\d])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:[^\d]|$)/)
  if (stamped) {
    const p = stamped.length === 7 ? stamped.slice(1) : stamped.slice(2)
    const [y, mo, d, h, mi, s] = p
    if (!validYmd(y, mo, d, h, mi, s)) return null
    return { local: `${y}-${mo}-${d}T${h}:${mi}:${s}` }
  }
  const day = base.match(/(20\d{2}|19\d{2})-(\d{2})-(\d{2})/)
  if (day && validYmd(day[1], day[2], day[3], '00', '00', '00')) {
    return { local: `${day[1]}-${day[2]}-${day[3]}T00:00:00` }
  }
  return null
}

function validYmd(y: string, mo: string, d: string, h: string, mi: string, s: string): boolean {
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < 1985 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false
  return true
}

export function displayOriginalInstant(input: {
  capturedAt?: string | null
  capturedLocal?: string | null
  capturedOffset?: string | null
  source?: string | null
  userAt?: string | null
}): { text: string; proven: boolean; explanation: string | null } {
  if (input.userAt) {
    const d = new Date(input.userAt)
    return {
      text: Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : input.userAt,
      proven: false,
      explanation: 'Corrected by you. The extracted metadata was kept.',
    }
  }
  if (input.source === 'file_last_modified') {
    return { text: 'Unknown', proven: false, explanation: 'No embedded capture date was found. The file modified time is not the original capture date.' }
  }
  if (input.source === 'filename_inferred' && input.capturedLocal) {
    return { text: input.capturedLocal.replace('T', ' '), proven: false, explanation: 'Inferred from the filename, not from embedded camera metadata.' }
  }
  if (input.capturedAt) {
    const d = new Date(input.capturedAt)
    return {
      text: Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : 'Unknown',
      proven: input.source !== 'filename_inferred',
      explanation: input.capturedOffset ? null : 'Timezone was not stored in the file, so this is the embedded clock time.',
    }
  }
  if (input.capturedLocal) {
    return {
      text: `${input.capturedLocal.replace('T', ' ')}${input.capturedOffset ? ` ${input.capturedOffset}` : ' (timezone unknown)'}`,
      proven: true,
      explanation: null,
    }
  }
  return { text: 'Unknown', proven: false, explanation: 'No trustworthy original capture date was found in this file.' }
}
