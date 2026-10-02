export type UploadMode = 'fast' | 'low-bandwidth'

const KEY = 'vault-upload-mode-v1'

export function normalizeUploadMode(value: unknown): UploadMode {
  return value === 'low-bandwidth' ? 'low-bandwidth' : 'fast'
}

export function getPreferredUploadMode(): UploadMode {
  if (typeof localStorage === 'undefined') return 'fast'
  try { return normalizeUploadMode(localStorage.getItem(KEY)) } catch { return 'fast' }
}

export function setPreferredUploadMode(mode: UploadMode): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(KEY, normalizeUploadMode(mode)) } catch { /* preference is optional */ }
}

export function uploadModeLabel(mode: UploadMode): string {
  return mode === 'low-bandwidth' ? 'Low bandwidth' : 'Fast'
}
