/**
 * Human-readable byte size (B, KB, MB, GB).
 * Null/invalid sizes return an em dash.
 */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

/** Human-readable binary size plus the authoritative integer byte count. */
export function formatBytesExact(n: number | null | undefined): string {
  if (n == null || !Number.isSafeInteger(n) || n < 0) return 'Unknown'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const readable = unit === 0 ? `${n} B` : `${value.toFixed(value >= 100 ? 1 : 2)} ${units[unit]}`
  return `${readable} (${n.toLocaleString('en-US')} bytes)`
}
