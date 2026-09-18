export function normalizeEtag(raw) {
  if (typeof raw !== 'string') return null
  let etag = raw.trim()
  if (!etag) return null
  if (/^w\//i.test(etag)) etag = etag.slice(2).trim()
  etag = etag.replace(/"/g, '').trim()
  if (!etag) return null
  return `"${etag}"`
}

export function normalizePartList(parts) {
  if (!Array.isArray(parts)) return null
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const n = Number(p?.PartNumber ?? p?.partNumber)
    const etag = normalizeEtag(p?.ETag ?? p?.etag)
    if (!Number.isInteger(n) || n < 1 || !etag) return null
    if (seen.has(n)) return null
    seen.add(n)
    out.push({ PartNumber: n, ETag: etag, Size: Number(p?.Size ?? p?.size ?? 0) || undefined })
  }
  out.sort((a, b) => a.PartNumber - b.PartNumber)
  for (let i = 0; i < out.length; i++) {
    if (out[i].PartNumber !== i + 1) return null
  }
  return out
}
