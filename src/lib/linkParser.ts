export type ParsedLink = {
  id: string
  url: string
  domain: string
  title: string
}

function secureId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function trimPunctuation(raw: string): string {
  let value = raw.replace(/[.,;:!?]+$/g, '')
  const pairs: [string, string][] = [['(', ')'], ['[', ']'], ['{', '}']]
  for (const [open, close] of pairs) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1)
  }
  return value
}

export function normalizeSafeHttpUrl(raw: string): string | null {
  const candidate = trimPunctuation(raw.trim())
  if (!candidate) return null
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

export function parseLinksFromText(text: string): ParsedLink[] {
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? []
  const seen = new Set<string>()
  const rows: ParsedLink[] = []
  for (const match of matches) {
    const url = normalizeSafeHttpUrl(match)
    if (!url || seen.has(url)) continue
    seen.add(url)
    rows.push({ id: secureId(), url, domain: displayDomain(url), title: '' })
  }
  return rows
}

export async function parseLinksIncrementally(
  text: string,
  onProgress?: (percent: number) => void,
): Promise<ParsedLink[]> {
  const chunks = text.match(/.{1,12000}/gs) ?? [text]
  const all: ParsedLink[] = []
  const seen = new Set<string>()
  for (let i = 0; i < chunks.length; i += 1) {
    for (const row of parseLinksFromText(chunks[i])) {
      if (!seen.has(row.url)) {
        seen.add(row.url)
        all.push(row)
      }
    }
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
    if (i + 1 < chunks.length) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return all
}

export function safeOpenLink(url: string): boolean {
  const safe = normalizeSafeHttpUrl(url)
  if (!safe) return false
  const anchor = document.createElement('a')
  anchor.href = safe
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.click()
  return true
}

export async function copyLinkToClipboard(url: string): Promise<boolean> {
  const safe = normalizeSafeHttpUrl(url)
  if (!safe) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(safe)
    return true
  }
  const textarea = document.createElement('textarea')
  textarea.value = safe
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}
