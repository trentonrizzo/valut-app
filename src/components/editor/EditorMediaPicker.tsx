import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileRow, PageCursor } from '../../types/media'
import { DEFAULT_MEDIA_FILTERS } from '../../types/media'
import { listMediaPage } from '../../lib/mediaQueries'
import { listTags } from '../../lib/tags'
import { supabase } from '../../lib/supabase'
import { classifyFileKind } from '../../lib/fileKind'
import { canRevealLockedContent } from '../../lib/locks'
import { albumViewAllowed } from '../../lib/albumPin'
import { VaultPhotoTileMedia } from '../files/VaultPhotoTile'
import { useDecryptedMediaSrc } from '../../hooks/useDecryptedMediaSrc'
import { RequestGeneration, toggleRecord } from '../../lib/editor/pickerState'

type Props = { open: boolean; userId: string; onClose: () => void; onAdd: (files: FileRow[]) => void; maxSelect?: number; projectFileIds?: string[] }
type Album = { id: string; name: string; parent_album_id?: string | null; is_protected?: boolean }
type Section = 'all' | 'albums' | 'favorites' | 'photos' | 'videos' | 'recent' | 'project' | 'used'

function Preview({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const { displayUrl, loading, failed } = useDecryptedMediaSrc(file.file_url, file.is_encrypted, file.user_id, file.file_name, file.id)
  const [mediaError, setMediaError] = useState(false)
  return <div className="editor-picker-preview" role="dialog" aria-label="Media preview">
    <button className="btn btn--outline" onClick={onClose}>Back to selection</button>
    <strong>{file.file_name}</strong>
    {loading ? <p role="status">Loading preview…</p> : failed || mediaError || !displayUrl ? <p>Preview unavailable on this device. The original has not been changed.</p> :
      classifyFileKind({ name: file.file_name, mime_type: file.mime_type }) === 'video'
        ? <video src={displayUrl} controls playsInline preload="metadata" onError={() => setMediaError(true)} />
        : <img src={displayUrl} alt={file.file_name} onError={() => setMediaError(true)} />}
  </div>
}

export function EditorMediaPicker({ open, userId, onClose, onAdd, maxSelect = 4, projectFileIds = [] }: Props) {
  const [rows, setRows] = useState<FileRow[]>([])
  const [cursor, setCursor] = useState<PageCursor | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Map<string, FileRow>>(new Map())
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [section, setSection] = useState<Section>('all')
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [tagId, setTagId] = useState<string | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FileRow | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>([])
  const requests = useRef(new RequestGeneration())
  const closeRef = useRef(onClose); closeRef.current = onClose
  const closeButton = useRef<HTMLButtonElement>(null)
  const projectKey = projectFileIds.join(',')
  const recentKey = recentIds.join(',')
  const [viewport, setViewport] = useState({ height: window.visualViewport?.height ?? window.innerHeight, top: 0 })

  useEffect(() => { const timer = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(timer) }, [search])
  useEffect(() => { if (!open) setPreview(null) }, [open])
  useEffect(() => { setSelected(new Map()); setRecentIds([]) }, [userId])
  useEffect(() => {
    if (!open) return
    let alive = true
    void Promise.all([
      listTags(userId),
      supabase.from('albums').select('*').eq('user_id', userId).order('order_index'),
    ]).then(([loadedTags, result]) => {
      if (!alive) return
      if (result.error) throw new Error(result.error.message)
      setTags(loadedTags); setAlbums((result.data ?? []) as Album[])
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load filters') })
    try { setRecentIds(JSON.parse(localStorage.getItem(`vault-editor-recent:${userId}`) || '[]')) } catch { setRecentIds([]) }
    return () => { alive = false }
  }, [open, userId])

  useEffect(() => {
    if (!open) return
    const priorFocus = document.activeElement as HTMLElement | null
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const resize = () => setViewport({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 })
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (preview) setPreview(null); else closeRef.current() }
      if (e.key === 'Tab') {
        const controls = [...document.querySelectorAll<HTMLElement>('.editor-browser button:not(:disabled), .editor-browser input, .editor-browser select')].filter(el => el.offsetParent !== null)
        const first = controls[0], last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    resize(); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize)
    window.addEventListener('keydown', keyboard)
    return () => {
      document.body.style.overflow = priorOverflow; priorFocus?.focus()
      window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize)
      window.removeEventListener('keydown', keyboard)
    }
  }, [open, preview])

  const filters = {
    ...DEFAULT_MEDIA_FILTERS, search: debounced, type: section === 'photos' ? 'photos' as const : section === 'videos' ? 'videos' as const : 'all' as const,
    favorite: section === 'favorites' ? 'yes' as const : 'all' as const,
    albumId: section === 'albums' ? albumId : null, tagIds: tagId ? [tagId] : [],
  }
  async function load(reset: boolean) {
    const request = requests.current.begin()
    setLoading(true); setError(null)
    try {
      const ids = section === 'project' ? projectFileIds : section === 'used' ? recentIds : undefined
      const page = ids?.length === 0 ? { rows: [], nextCursor: null } : await listMediaPage({ userId, filters, cursor: reset ? null : cursor, limit: 36, signal: request.signal, fileIds: ids })
      if (!request.current()) return
      setRows(prev => reset ? page.rows : [...prev, ...page.rows]); setCursor(page.nextCursor)
    } catch (e) { if (request.current()) setError(e instanceof Error ? e.message : 'Could not load media') }
    finally { if (request.current()) setLoading(false) }
  }
  useEffect(() => {
    if (!open) return
    setRows([]); setCursor(null); void load(true)
    const generation = requests.current
    return () => generation.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query identity, not result cursor, triggers a reset
  }, [open, userId, debounced, section, albumId, tagId, projectKey, recentKey])

  if (!open) return null
  const breadcrumb: Album[] = []
  const seen = new Set<string>()
  let parent = albums.find(a => a.id === albumId)
  while (parent && !seen.has(parent.id)) { breadcrumb.unshift(parent); seen.add(parent.id); parent = albums.find(a => a.id === parent?.parent_album_id) }
  const children = albums.filter(a => (a.parent_album_id ?? null) === albumId)
  const mediaRows = rows.filter(f => ['image', 'video'].includes(classifyFileKind({ name: f.file_name, mime_type: f.mime_type })))
  return createPortal(<div className="editor-browser-backdrop">
    <section className="editor-browser" role="dialog" aria-modal="true" aria-label="Vault media browser" style={{ height: viewport.height, top: viewport.top }}>
      <header className="editor-browser__header">
        <div className="editor-picker__top"><h2>Add Vault media</h2><button ref={closeButton} className="btn btn--outline" onClick={onClose}>Close</button></div>
        <input className="field-input" placeholder="Search filenames and tags" aria-label="Search filenames and tags" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="editor-browser__filters">
          <select className="field-input" aria-label="Media source" value={section} onChange={e => setSection(e.target.value as Section)}>
            {([['all','All Media'],['albums','Albums'],['favorites','Favorites'],['photos','Photos'],['videos','Videos'],['recent','Recently Added'],['project','Project Media'],['used','Recently Used']] as const).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select className="field-input" aria-label="Tag" value={tagId ?? ''} onChange={e => setTagId(e.target.value || null)}><option value="">All tags</option>{tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </div>
        {section === 'albums' ? <nav aria-label="Album breadcrumb"><button className="btn btn--ghost" onClick={() => setAlbumId(null)}>Albums</button>{breadcrumb.map(a => <button className="btn btn--ghost" key={a.id} onClick={() => setAlbumId(a.id)}> / {a.name}</button>)}</nav> : null}
      </header>
      <div className="editor-browser__scroll">
        {section === 'albums' ? <div className="editor-browser__albums">{children.map(a => <button className="btn btn--outline" key={a.id} disabled={!albumViewAllowed(a)} onClick={() => setAlbumId(a.id)}>{a.name}{!albumViewAllowed(a) ? ' · unlock in Albums first' : ''}</button>)}</div> : null}
        {error ? <p role="alert">{error} <button className="btn" onClick={() => void load(true)}>Retry</button></p> : null}
        <div className="editor-picker-grid">
          {mediaRows.map(file => <div key={file.id} className="editor-browser__item">
            <button className={`editor-picker-tile ${selected.has(file.id) ? 'is-selected' : ''}`} disabled={!canRevealLockedContent(file)} aria-label={`Select ${file.file_name}`} aria-pressed={selected.has(file.id)} onClick={() => setSelected(prev => toggleRecord(prev, file, maxSelect))}>
              {canRevealLockedContent(file) ? <VaultPhotoTileMedia file={file} userId={userId} /> : <span>Locked</span>}
              {selected.has(file.id) ? <span className="editor-picker-tile__check">✓</span> : null}
            </button>
            <button className="editor-browser__preview" disabled={!canRevealLockedContent(file)} onClick={() => setPreview(file)}>Preview <span>{file.file_name}</span></button>
          </div>)}
        </div>
        {loading ? <p role="status">Loading…</p> : !mediaRows.length ? <p>No matching photos or videos.</p> : null}
        {cursor ? <button className="btn btn--outline" disabled={loading} onClick={() => void load(false)}>Load more</button> : null}
      </div>
      <footer className="editor-browser__footer"><span>{selected.size} selected · {maxSelect} available</span><button className="btn btn--ghost" onClick={() => setSelected(new Map())}>Clear</button><button className="btn btn--primary" disabled={!selected.size || selected.size > maxSelect} onClick={() => {
        const files = [...selected.values()]
        const recent = [...new Set([...files.map(f => f.id), ...recentIds])].slice(0, 200)
        try { localStorage.setItem(`vault-editor-recent:${userId}`, JSON.stringify(recent)) } catch { /* optional recent history */ }
        setRecentIds(recent); onAdd(files); setSelected(new Map())
      }}>Add {selected.size || ''}</button></footer>
      {preview ? <Preview key={preview.id} file={preview} onClose={() => setPreview(null)} /> : null}
    </section>
  </div>, document.body)
}
