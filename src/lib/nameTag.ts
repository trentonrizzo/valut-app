/** Confident person-name detection from filenames and titles. No image analysis. */

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'from', 'with', 'in', 'on', 'at', 'by', 'vs',
  'ft', 'feat', 'featuring', 'aka', 'mr', 'mrs', 'ms', 'miss', 'dr', 'website', 'site', 'web',
  'www', 'http', 'https', 'com', 'net', 'org', 'video', 'videos', 'clip', 'clips', 'img', 'dsc',
  'mov', 'vid', 'photo', 'photos', 'image', 'images', 'file', 'files', 'download', 'downloads',
  'new', 'final', 'copy', 'edit', 'edited', 'raw', 'hd', 'fhd', 'uhd', 'hdr', 'sd', 'full',
  'complete', 'pack', 'set', 'vol', 'volume', 'part', 'episode', 'ep', 'scene', 'trailer',
  'official', 'collection', 'album', 'folder', 'camera', 'iphone', 'android', 'samsung',
  'screenshot', 'screen', 'recording', 'record', 'untitled', 'unknown', 'misc', 'other', 'test',
  'sample', 'private', 'inbox', 'saved', 'telegram', 'whatsapp', 'discord', 'reddit', 'twitter',
  'instagram', 'tiktok', 'youtube', 'onlyfans', 'fansly', 'pornhub', 'xvideos', 'xhamster',
  'chaturbate', 'manyvids', 'cam', 'cams', 'model', 'girl', 'boy', 'teen', 'hot', 'sexy', 'nude',
  'naked', 'solo', 'couple', 'pov', 'homemade', 'amateur', 'professional', 'studio', 'series',
  'season', 'chapter', 'page', 'scan', 'note', 'notes', 'link', 'url', 'leak', 'leaked', 'premium',
  'free', 'watch', 'online', 'stream', 'upload', 'original', 'compressed', 'export', 'render',
  'draft', 'temp', 'tmp', 'backup', 'old', 'latest', 'best', 'top', 'my', 'your', 'our', 'this',
  'that', 'vacation', 'holiday', 'beach', 'summer', 'winter', 'party', 'trip', 'travel', 'home',
  'house', 'night', 'day', 'morning', 'birthday', 'wedding', 'concert', 'show', 'movie', 'film',
  'music', 'song', 'audio', 'voice', 'call', 'chat', 'message', 'pic', 'pics', 'thumb', 'preview',
])

const PARTICLES = new Set(['de', 'da', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'den'])

export type NameSources = {
  filename?: string | null
  alternateFilename?: string | null
  title?: string | null
  sourceUrl?: string | null
}

export function detectPersonName(sources: NameSources): string | null {
  for (const label of [sources.filename, sources.alternateFilename]) {
    const value = text(label)
    if (!value) continue
    const found = nameFromLabel(value)
    if (found) return found
  }
  const title = text(sources.title)
  if (title && title.length <= 80) {
    const fromTitle = nameFromLabel(title)
    if (fromTitle) return fromTitle
  }
  const fromUrl = nameFromSourceUrl(sources.sourceUrl)
  return fromUrl
}

export function nameFromLabel(raw: string): string | null {
  const cleaned = raw
    .replace(/\.[a-z0-9]{1,5}$/i, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w-]+\.(com|net|org|io|tv|me|co|xxx)\b/gi, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
  const segments = cleaned.split(/\s+[-–—|]\s+|\s{2,}/).map((part) => part.trim()).filter(Boolean)
  const found = new Set<string>()
  for (const segment of segments.length ? segments : [cleaned]) {
    const name = nameFromSegment(segment)
    if (name) found.add(name)
  }
  if (found.size === 1) return [...found][0]
  return null
}

function nameFromSourceUrl(sourceUrl: string | null | undefined): string | null {
  const raw = text(sourceUrl)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
    if (!last || last === url.hostname) return null
    return nameFromLabel(last)
  } catch {
    return nameFromLabel(raw.split('/').pop() || '')
  }
}

function nameFromSegment(segment: string): string | null {
  const tokens = segment.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  while (tokens.length && isNoise(tokens[0])) tokens.shift()
  while (tokens.length && isNoise(tokens[tokens.length - 1])) tokens.pop()
  if (tokens.length < 2 || tokens.length > 3) return null
  if (!tokens.every((token, index) => isNameToken(token, index, tokens.length))) return null
  return titleCase(tokens)
}

function isNoise(token: string): boolean {
  const value = token.toLowerCase().replace(/^#+/, '')
  if (!value) return true
  if (STOP.has(value)) return true
  if (/^\d+$/.test(value)) return true
  if (/^\d{3,4}p$/.test(value)) return true
  if (/^(4k|8k|hd|fhd|uhd|hdr|sd|v\d+)$/.test(value)) return true
  if (/^(copy|final|edit|part|ep|vol|pt)\d*$/.test(value)) return true
  return false
}

function isNameToken(token: string, index: number, count: number): boolean {
  if (!/^[A-Za-z](?:[A-Za-z]|['’][A-Za-z]|-[A-Za-z])+$/.test(token)) return false
  const lower = token.toLowerCase()
  if (STOP.has(lower) || isNoise(token)) return false
  if (lower.length < 3) return count === 3 && index === 1 && PARTICLES.has(lower)
  if (lower.length > 16) return false
  return true
}

function titleCase(tokens: string[]): string {
  return tokens.map((token, index) => {
    const lower = token.toLowerCase()
    if (index > 0 && index < tokens.length - 1 && PARTICLES.has(lower)) return lower
    return lower.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join('-')
      .replace(/(['’])([a-z])/g, (_, mark, letter) => `${mark}${letter.toUpperCase()}`)
  }).join(' ')
}

function text(value: string | null | undefined): string {
  return String(value || '').trim()
}
