import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { supabase } from '../lib/supabase'
import { buildAlbumsWithMeta, fetchAlbumsWithCounts } from '../lib/albumQueries'
import { isAlbumGalleryFile, listAlbumMemberFiles, reconcileLegacyAlbumMemberships } from '../lib/albumMembers'
import { albumViewAllowed, clearAlbumPassword, setAlbumPassword, verifyAlbumPassword } from '../lib/albumPin'
import { addFilesToAlbum, moveFilesToAlbum, removeFilesFromAlbum } from '../lib/albumMembership'
import { softDeleteFiles } from '../lib/trash'
import { BulkActionBar } from '../components/library/BulkActionBar'
import { isV11SchemaReady } from '../lib/schemaGuard'
import { formatBytes } from '../lib/formatBytes'
import { isVideoFileName } from '../lib/mediaTypes'
import type { AlbumRow, AlbumWithMeta } from '../types/album'
import { AlbumGrid } from '../components/albums/AlbumGrid'
import { CreateAlbumModal } from '../components/albums/CreateAlbumModal'
import { RenameAlbumModal } from '../components/albums/RenameAlbumModal'
import { ConfirmDeleteAlbumModal } from '../components/albums/ConfirmDeleteAlbumModal'
import { AlbumCoverPickerModal } from '../components/albums/AlbumCoverPickerModal'
import { VaultPhotoTileMedia } from '../components/files/VaultPhotoTile'
import { UploadQueueOverlay, type UploadQueueItem } from '../components/UploadQueueOverlay'
import { batchUploadFilesToAlbum, validateUploadFileSizes } from '../lib/batchUploadToAlbum'
import { filesFromInput, logUploadSelection, selectionFailureReason } from '../lib/upload/selectFiles'
import {
  attachFileForResume,
  batchTotals,
  cancelJob,
  dismissFailed,
  getLiveUploads,
  pauseJob,
  resumeJob,
  retryAllFailed,
  retryJob,
  subscribeUploads,
} from '../lib/upload/manager'
import { liveToQueueItems } from '../lib/upload/queueUi'
import { formatEta } from '../lib/upload/strategy'
import { sortGalleryFiles, type FileSort } from '../lib/gallerySort'
import { useDecryptedMediaSrc } from '../hooks/useDecryptedMediaSrc'

const GALLERY_COLS_KEY = 'vault-gallery-grid-cols'
type GalleryCols = 1 | 2 | 3 | 4 | 5

function loadGalleryCols(): GalleryCols {
  try {
    const raw = localStorage.getItem(GALLERY_COLS_KEY)
    const n = raw ? parseInt(raw, 10) : 3
    if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n
  } catch {
    /* ignore */
  }
  return 3
}

function GridColsIcon({ cols }: { cols: number }) {
  const g = 20 / cols
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="vault-grid-cols__icon">
      {Array.from({ length: cols }).map((_, i) => (
        <rect
          key={i}
          x={i * g + 0.6}
          y={2}
          width={g - 1.2}
          height={16}
          rx="1.2"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { albumId: albumIdParam, fileId: mediaFileId } = useParams<{ albumId?: string; fileId?: string }>()
  const navigate = useNavigate()
  const openAlbumId = albumIdParam ?? null

  const [albums, setAlbums] = useState<AlbumWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AlbumWithMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AlbumWithMeta | null>(null)
  const [coverPickerAlbum, setCoverPickerAlbum] = useState<AlbumWithMeta | null>(null)
  const [protectTarget, setProtectTarget] = useState<AlbumWithMeta | null>(null)
  const [moveTarget, setMoveTarget] = useState<AlbumWithMeta | null>(null)
  const [protectPin, setProtectPin] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [albumUnlocked, setAlbumUnlocked] = useState(0)
  const [albumSelected, setAlbumSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [creatingAlbum, setCreatingAlbum] = useState(false)

  type FileRow = {
    id: string
    user_id: string
    album_id: string
    file_name: string
    file_url: string
    created_at: string
    file_size_bytes?: number | null
    purpose?: string | null
    is_encrypted?: boolean | null
    mime_type?: string | null
    storage_key?: string | null
    thumbnail_key?: string | null
    poster_key?: string | null
  }

  function isGalleryFile(f: { purpose?: string | null; upload_status?: string | null; deleted_at?: string | null }): boolean {
    return isAlbumGalleryFile(f)
  }

  const [files, setFiles] = useState<FileRow[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filesHasMore, setFilesHasMore] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)
  const [uploadBatchIndex, setUploadBatchIndex] = useState(0)
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0)
  const [uploadEtaText, setUploadEtaText] = useState<string | null>(null)
  const [uploadCurrentFilePercent, setUploadCurrentFilePercent] = useState<number | null>(null)
  const uploadStartMsRef = useRef(0)
  const uploadTotalBytesRef = useRef(0)
  const uploadLockRef = useRef(false)
  const fileByQueueIdRef = useRef<Map<string, File>>(new Map())
  const optimisticRowByQueueIdRef = useRef<Map<string, FileRow>>(new Map())

  const [uploadQueueItems, setUploadQueueItems] = useState<UploadQueueItem[]>([])
  const [uploadLiveTick, setUploadLiveTick] = useState(0)

  useEffect(() => subscribeUploads(() => setUploadLiveTick((n) => n + 1)), [])
  const liveQueueItems = useMemo(() => {
    void uploadLiveTick
    return liveToQueueItems(getLiveUploads())
  }, [uploadLiveTick])
  const liveTotals = batchTotals(getLiveUploads())
  const liveCurrent = getLiveUploads().find((j) =>
    ['uploading', 'preparing', 'encrypting', 'finalizing', 'retrying'].includes(j.state),
  )

  const [fileActionTarget, setFileActionTarget] = useState<FileRow | null>(null)
  const [fileInfoTarget, setFileInfoTarget] = useState<FileRow | null>(null)

  const fileActionMedia = useDecryptedMediaSrc(
    fileActionTarget?.file_url ?? null,
    fileActionTarget?.is_encrypted,
    user?.id ?? null,
    fileActionTarget?.file_name ?? '',
    fileActionTarget?.id,
  )
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTouchStartRef = useRef<{ x: number; y: number } | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressTouchStartRef.current = null
  }, [])

  const [columns, setColumns] = useState(3)

  const [fileSort, setFileSort] = useState<FileSort>('newest')
  const [galleryCols, setGalleryCols] = useState<GalleryCols>(loadGalleryCols)

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_COLS_KEY, String(galleryCols))
    } catch {
      /* ignore */
    }
  }, [galleryCols])

  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const refreshAlbums = useCallback(async () => {
    if (!user) return

    await reconcileLegacyAlbumMemberships(user.id)
    const { data, error } = await fetchAlbumsWithCounts(user.id)
    if (error) {
      setFetchError(error)
      setAlbums([])
      return
    }

    setFetchError(null)
    setAlbums(data ?? [])
  }, [user])

  const finishAlbumUploadUi = useCallback(() => {
    uploadLockRef.current = false
    setUploading(false)
    setUploadProgress(0)
    setUploadFileName(null)
    setUploadBatchIndex(0)
    setUploadBatchTotal(0)
    setUploadEtaText(null)
    setUploadCurrentFilePercent(null)
  }, [])

  const runAlbumUpload = useCallback(
    async (filesArray: File[], optimisticUrls: string[], queueIds: string[]) => {
      const cleanupOptimistic = () => {
        queueIds.forEach((qid, i) => {
          const u = optimisticUrls[i]
          if (u) URL.revokeObjectURL(u)
          optimisticRowByQueueIdRef.current.delete(qid)
          fileByQueueIdRef.current.delete(qid)
        })
        setFiles((prev) => prev.filter((row) => !queueIds.includes(row.id)))
        setUploadQueueItems((prev) => prev.filter((item) => !queueIds.includes(item.id)))
      }

      if (!user || !openAlbumId) {
        console.error('UPLOAD ABORT: missing user or album')
        cleanupOptimistic()
        finishAlbumUploadUi()
        alert('Upload failed: not signed in or no album open.')
        return
      }
      if (filesArray.length === 0) {
        cleanupOptimistic()
        finishAlbumUploadUi()
        return
      }

      let fileIds: (string | null)[]
      let failed: string[]
      let total: number
      let errors: (string | null)[] = []

      try {
        const r = await batchUploadFilesToAlbum(
          filesArray,
          openAlbumId,
          user.id,
          { uploadStartMsRef, uploadTotalBytesRef },
          (p) => {
            setUploadProgress(p.progress)
            setUploadFileName(p.fileName)
            setUploadBatchIndex(p.batchIndex)
            setUploadBatchTotal(p.batchTotal)
            setUploadEtaText(p.etaText)
            if (p.currentFilePercent != null) setUploadCurrentFilePercent(p.currentFilePercent)
            const idx = p.currentFileIndex - 1
            if (idx >= 0 && idx < queueIds.length) {
              const targetId = queueIds[idx]!
              setUploadQueueItems((prev) =>
                prev.map((item) =>
                  item.id === targetId
                    ? {
                        ...item,
                        progress: p.currentFilePercent ?? item.progress,
                        name: p.fileName ?? item.name,
                        status: item.status === 'queued' ? 'uploading' : item.status,
                      }
                    : item,
                ),
              )
            }
          },
        )
        fileIds = r.fileIds
        failed = r.failed
        total = r.total
        errors = r.errors
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        queueIds.forEach((qid, i) => {
          URL.revokeObjectURL(optimisticUrls[i]!)
          optimisticRowByQueueIdRef.current.delete(qid)
          fileByQueueIdRef.current.delete(qid)
        })
        setFiles((prev) => prev.filter((row) => !queueIds.includes(row.id)))
        setUploadQueueItems((prev) =>
          prev.map((item) =>
            queueIds.includes(item.id) ? { ...item, status: 'failed', error: msg } : item,
          ),
        )
        console.error(err)
        showToast(msg, 'error')
        alert(`Upload failed: ${msg}`)
        finishAlbumUploadUi()
        return
      }

      let serverRows: FileRow[] = []
      try {
        const page = await listAlbumMemberFiles(user.id, openAlbumId, { offset: 0, limit: 200 })
        serverRows = page.rows.filter(isGalleryFile) as FileRow[]
      } catch (err) {
        const refreshMsg = err instanceof Error ? err.message : 'Could not refresh album'
        console.error(err)
        showToast(refreshMsg, 'error')
        alert(`Upload failed: ${refreshMsg}`)
        setUploadQueueItems((prev) =>
          prev.map((item) => {
            const i = queueIds.indexOf(item.id)
            if (i === -1) return item
            if (fileIds[i]) return { ...item, status: 'done', progress: 100, error: null }
            return {
              ...item,
              status: 'failed',
              progress: item.progress,
              error: errors[i] ?? 'Could not refresh album',
            }
          }),
        )
        await refreshAlbums()
        finishAlbumUploadUi()
        return
      }

      const keepFailed: FileRow[] = []
      queueIds.forEach((qid, i) => {
        if (!fileIds[i]) {
          const row = optimisticRowByQueueIdRef.current.get(qid)
          if (row) keepFailed.push(row)
        } else {
          optimisticRowByQueueIdRef.current.delete(qid)
          fileByQueueIdRef.current.delete(qid)
        }
      })

      setFiles([...keepFailed, ...serverRows])
      await refreshAlbums()

      setUploadQueueItems((prev) =>
        prev.map((item) => {
          const i = queueIds.indexOf(item.id)
          if (i === -1) return item
          if (fileIds[i]) return { ...item, status: 'done', progress: 100, error: null }
          const errMsg = errors[i] ?? 'Upload failed'
          return { ...item, status: 'failed', progress: item.progress, error: errMsg }
        }),
      )

      if (failed.length === 0) {
        showToast(total === 1 ? 'Upload complete' : `Uploaded ${total} files`)
        setTimeout(() => {
          setUploadQueueItems((prev) => prev.filter((it) => !queueIds.includes(it.id)))
        }, 400)
      } else if (failed.length === total) {
        showToast('All uploads failed', 'error')
      } else {
        showToast(
          `Uploaded ${total - failed.length} of ${total} files. Failed: ${failed.join(', ')}`,
          'error',
        )
      }

      finishAlbumUploadUi()
    },
    [user, openAlbumId, showToast, refreshAlbums, finishAlbumUploadUi],
  )

  const dismissFailedUploadQueue = useCallback(() => {
    setUploadQueueItems((prev) => {
      const failed = prev.filter((i) => i.status === 'failed')
      for (const item of failed) {
        const row = optimisticRowByQueueIdRef.current.get(item.id)
        if (row?.file_url.startsWith('blob:')) URL.revokeObjectURL(row.file_url)
        optimisticRowByQueueIdRef.current.delete(item.id)
        fileByQueueIdRef.current.delete(item.id)
      }
      const failedIds = new Set(failed.map((i) => i.id))
      if (failedIds.size) {
        setFiles((filesPrev) => filesPrev.filter((f) => !failedIds.has(f.id)))
      }
      return []
    })
  }, [])

  const retryUploadQueueItem = useCallback(
    (queueId: string) => {
      const file = fileByQueueIdRef.current.get(queueId)
      if (!file || !user || !openAlbumId) return
      const row = optimisticRowByQueueIdRef.current.get(queueId)
      const optimisticUrl = row?.file_url ?? URL.createObjectURL(file)
      if (!row) {
        const newRow: FileRow = {
          id: queueId,
          user_id: user.id,
          album_id: openAlbumId,
          file_name: file.name,
          file_url: optimisticUrl,
          created_at: new Date().toISOString(),
          file_size_bytes: file.size,
          purpose: 'content',
          is_encrypted: false,
          mime_type: file.type || null,
        }
        optimisticRowByQueueIdRef.current.set(queueId, newRow)
        setFiles((prev) => (prev.some((f) => f.id === queueId) ? prev : [newRow, ...prev]))
      }

      setUploadQueueItems((prev) =>
        prev.map((it) =>
          it.id === queueId
            ? { ...it, status: 'queued', progress: 0, error: null }
            : it,
        ),
      )
      setUploading(true)
      uploadLockRef.current = true
      setUploadProgress(0)
      setUploadFileName(file.name)
      setUploadBatchTotal(1)
      setUploadBatchIndex(1)
      setUploadEtaText(null)
      setUploadCurrentFilePercent(0)
      requestAnimationFrame(() => {
        setTimeout(() => {
          void runAlbumUpload([file], [optimisticUrl], [queueId])
        }, 0)
      })
    },
    [user, openAlbumId, runAlbumUpload],
  )

  const persistAlbumOrder = useCallback(
    async (reordered: AlbumWithMeta[]) => {
      if (!user) return
      const rows = reordered
        .map((album, index) => ({ id: album.id, order_index: index }))
        .filter((row) => !String(row.id).startsWith('optimistic-'))
      if (rows.length === 0) return
      for (const row of rows) {
        const { error } = await supabase
          .from('albums')
          .update({ order_index: row.order_index })
          .eq('id', row.id)
          .eq('user_id', user.id)
        if (error) {
          showToast(error.message, 'error')
          break
        }
      }
    },
    [showToast, user],
  )

  const handleAlbumReorder = useCallback(
    (next: AlbumWithMeta[]) => {
      const withIndex = next.map((a, i) => ({ ...a, order_index: i }))
      setAlbums(withIndex)
      void persistAlbumOrder(withIndex)
    },
    [persistAlbumOrder],
  )

  const openAlbum = useMemo(() => {
    if (!openAlbumId) return null
    return albums.find((a) => a.id === openAlbumId) ?? null
  }, [albums, openAlbumId])

  const rootAlbums = useMemo(() => albums.filter((a) => !a.parent_album_id), [albums])

  const childAlbums = useMemo(() => {
    if (!openAlbumId) return []
    return albums.filter((a) => a.parent_album_id === openAlbumId)
  }, [albums, openAlbumId])

  const albumBreadcrumb = useMemo(() => {
    if (!openAlbum) return [] as AlbumWithMeta[]
    const chain: AlbumWithMeta[] = []
    let cursor: AlbumWithMeta | null = openAlbum
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      chain.unshift(cursor)
      const pid: string | null | undefined = cursor.parent_album_id
      cursor = pid ? albums.find((a) => a.id === pid) ?? null : null
    }
    return chain
  }, [openAlbum, albums])

  const displayFiles = useMemo(() => sortGalleryFiles(files, fileSort), [files, fileSort])
  void albumUnlocked

  useEffect(() => {
    setFileSort('newest')
  }, [albumIdParam])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    ;(async () => {
      await reconcileLegacyAlbumMemberships(user.id)
      const { data, error } = await fetchAlbumsWithCounts(user.id)
      if (cancelled) return

      if (error) {
        setFetchError(error)
        setAlbums([])
      } else {
        const list = data ?? []
        setFetchError(null)
        setAlbums(list)
      }

      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user || !openAlbumId) {
      setFiles([])
      return
    }

    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)

    ;(async () => {
      try {
        const page = await listAlbumMemberFiles(user.id, openAlbumId, { offset: 0, limit: 48 })
        if (!cancelled) {
          const rows = page.rows.filter(isGalleryFile) as FileRow[]
          setFiles(rows)
          setFilesHasMore(page.hasMore)
        }
      } catch (e) {
        if (cancelled) return
        setFiles([])
        setFilesError(e instanceof Error ? e.message : 'Could not load files')
      } finally {
        if (!cancelled) setFilesLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, openAlbumId])

  async function handleCreateAlbum(name: string, parentAlbumId: string | null = null) {
    if (!user) throw new Error('Not signed in.')

    const tempId = `optimistic-${crypto.randomUUID()}`
    const maxOrder = albums.reduce((m, a) => Math.max(m, a.order_index ?? 0), -1)
    const nextOrder = maxOrder + 1
    const parentId = parentAlbumId ?? null
    const optimistic: AlbumWithMeta = {
      id: tempId,
      user_id: user.id,
      name,
      created_at: new Date().toISOString(),
      itemCount: 0,
      totalBytes: 0,
      previewUrl: null,
      previewIsVideo: false,
      previewIsEncrypted: false,
      previewFileName: null,
      previewFileId: null,
      order_index: nextOrder,
      cover_file_id: null,
      is_protected: false,
      parent_album_id: parentId,
      childCount: 0,
    }

    setAlbums((prev) => [...prev, optimistic])
    setCreatingAlbum(true)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, unknown> = { user_id: user.id, name, order_index: nextOrder }
      if (parentId) payload.parent_album_id = parentId
      const { data, error } = await (supabase as any).from('albums').insert(payload).select().single()

      if (error) throw new Error(error.message)

      const real = buildAlbumsWithMeta([data as AlbumRow], [])[0]
      setAlbums((prev) => prev.map((a) => (a.id === tempId ? { ...real, parent_album_id: parentId } : a)))
      navigate(`/albums/${real.id}`)
      showToast('Collection created')
    } catch (e) {
      setAlbums((prev) => prev.filter((a) => a.id !== tempId))
      const msg = e instanceof Error ? e.message : 'Could not create album'
      showToast(msg, 'error')
      throw e instanceof Error ? e : new Error(msg)
    } finally {
      setCreatingAlbum(false)
    }
  }

  async function handleMoveCollection(album: AlbumWithMeta, newParentId: string | null) {
    if (!user) return
    if (newParentId === album.id) {
      showToast('Collection cannot be its own parent', 'error')
      return
    }
    if (newParentId) {
      let cursor: string | null = newParentId
      const seen = new Set<string>([album.id])
      for (let i = 0; i < 32 && cursor; i += 1) {
        if (seen.has(cursor)) {
          showToast('That move would create a cycle', 'error')
          return
        }
        seen.add(cursor)
        const row = albums.find((a) => a.id === cursor)
        cursor = row?.parent_album_id ?? null
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('albums')
      .update({ parent_album_id: newParentId })
      .eq('id', album.id)
      .eq('user_id', user.id)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    setAlbums((prev) => prev.map((a) => (a.id === album.id ? { ...a, parent_album_id: newParentId } : a)))
    setMoveTarget(null)
    showToast(newParentId ? 'Moved under parent' : 'Moved to root')
  }

  async function handleRename(newName: string) {
    if (!renameTarget || !user) return

    const id = renameTarget.id
    const prevName = renameTarget.name

    setBusy(id, true)
    setAlbums((prev) => prev.map((a) => (a.id === id ? { ...a, name: newName } : a)))

    try {
      const { error } = await supabase
        .from('albums')
        .update({ name: newName })
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw new Error(error.message)
      showToast('Album renamed')
    } catch (e) {
      setAlbums((prev) => prev.map((a) => (a.id === id ? { ...a, name: prevName } : a)))
      const msg = e instanceof Error ? e.message : 'Could not rename album'
      showToast(msg, 'error')
      throw e instanceof Error ? e : new Error(msg)
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || !user) return

    const removed = deleteTarget
    const id = removed.id

    try {
      const schemaReady = await isV11SchemaReady()
      if (!schemaReady) {
        throw new Error(
          'V1.1 database migration is not applied yet. Album delete is blocked because the live schema still cascade-deletes files.',
        )
      }
      const { error } = await supabase.from('albums').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw new Error(error.message)
      setAlbums((prev) => prev.filter((a) => a.id !== id))
      if (openAlbumId === id) navigate('/albums')
      setDeleteTarget(null)
      showToast('Album deleted')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete album', 'error')
    }
  }

  const albumCountLabel =
    albums.length === 0 ? 'No albums' : albums.length === 1 ? '1 album' : `${albums.length} albums`

  return (
    <>
      {mediaFileId && albumIdParam ? (
        <Outlet />
      ) : (
        <div className="dashboard">
          <main className="dashboard__main">
        {!openAlbumId ? (
          <>
            <div className="dashboard__toolbar">
              <div>
                <h1 className="dashboard__title">Albums</h1>
                <p className="dashboard__subtitle">
                  {loading ? 'Loading…' : albumCountLabel} · Tap an album to open it
                </p>
              </div>
              <div className="dashboard__toolbar-actions">
                <div className="vault-grid-cols" role="toolbar" aria-label="Album grid columns">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`vault-grid-cols__btn ${columns === n ? 'is-active' : ''}`}
                      onClick={() => setColumns(n)}
                      aria-pressed={columns === n}
                      title={`${n} column${n === 1 ? '' : 's'}`}
                    >
                      <GridColsIcon cols={n} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreateModalOpen(true)}
                  disabled={loading || creatingAlbum}
                >
                  {creatingAlbum ? 'Creating…' : 'Create album'}
                </button>
              </div>
            </div>

            {fetchError ? (
              <div className="banner banner--error" role="alert">
                <strong>Could not load albums.</strong> {fetchError}
              </div>
            ) : null}

            {loading ? (
              <div className="album-skeleton-grid" aria-busy="true" aria-label="Loading albums">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="album-skeleton-card" />
                ))}
              </div>
            ) : (
              <AlbumGrid
                albums={rootAlbums}
                userId={user?.id ?? ''}
                columns={columns}
                busyAlbumIds={busyIds}
                activeAlbumId={openAlbumId}
                onOpen={(album) => navigate(`/albums/${album.id}`)}
                onRename={(a) => setRenameTarget(a)}
                onDelete={(a) => setDeleteTarget(a)}
                onSetCover={(a) => setCoverPickerAlbum(a)}
                onProtect={(a) => {
                  setProtectTarget(a)
                  setProtectPin('')
                }}
                onMove={(a) => setMoveTarget(a)}
                onCreateClick={() => setCreateModalOpen(true)}
                onReorder={handleAlbumReorder}
              />
            )}
          </>
        ) : (
          <section className="vault-panel vault-panel--detail vault-panel--gallery">
            <div className="vault-gallery-toolbar">
              <button
                type="button"
                className="btn btn--ghost vault-gallery-toolbar__back"
                onClick={() => {
                  const parentId = openAlbum?.parent_album_id
                  navigate(parentId ? `/albums/${parentId}` : '/albums')
                }}
              >
                ← {openAlbum?.parent_album_id ? 'Parent' : 'All albums'}
              </button>
              <div className="vault-gallery-toolbar__title">
                <nav className="album-breadcrumb" aria-label="Collection path">
                  <button type="button" className="album-breadcrumb__link" onClick={() => navigate('/albums')}>
                    Albums
                  </button>
                  {albumBreadcrumb.map((a) => (
                    <span key={a.id}>
                      <span className="album-breadcrumb__sep" aria-hidden>
                        /
                      </span>
                      <button
                        type="button"
                        className="album-breadcrumb__link"
                        onClick={() => navigate(`/albums/${a.id}`)}
                      >
                        {a.name}
                      </button>
                    </span>
                  ))}
                </nav>
                <h2 className="vault-gallery-toolbar__name">{openAlbum?.name ?? 'Album'}</h2>
                <span className="vault-gallery-toolbar__count" aria-label="Item count">
                  {files.length === 0
                    ? 'Empty'
                    : files.length === 1
                      ? '1 item'
                      : `${files.length} items`}
                  {childAlbums.length > 0 ? ` · ${childAlbums.length} nested` : ''}
                </span>
              </div>
              <div className="vault-gallery-toolbar__actions">
                <div className="vault-grid-cols" role="toolbar" aria-label="Columns in grid">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`vault-grid-cols__btn ${galleryCols === n ? 'is-active' : ''}`}
                      onClick={() => setGalleryCols(n)}
                      aria-pressed={galleryCols === n}
                      title={`${n} column${n === 1 ? '' : 's'}`}
                    >
                      <GridColsIcon cols={n} />
                    </button>
                  ))}
                </div>
                <select
                  className="vault-sort-select vault-sort-select--files vault-sort-select--compact"
                  value={fileSort}
                  onChange={(e) => setFileSort(e.target.value as FileSort)}
                  aria-label="Sort files in album"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="largest">Largest</option>
                  <option value="smallest">Smallest</option>
                  <option value="images_first">Images first</option>
                  <option value="videos_first">Videos first</option>
                </select>
                <label
                  className="btn btn--outline vault-upload-btn vault-upload-btn--toolbar"
                  aria-disabled={uploading || !openAlbumId}
                >
                  Upload
                  <input
                  type="file"
                  accept="image/*,video/*,.mp4,.mov,.m4v,.qt,.MP4,.MOV,video/mp4,video/quicktime,*/*"
                  multiple
                  disabled={uploading || !openAlbumId}
                  onChange={(e) => {
                    const input = e.currentTarget
                    let filesArray: File[] = []
                    try {
                      filesArray = filesFromInput(input.files)
                    } catch (err) {
                      input.value = ''
                      const msg = err instanceof Error ? err.message : 'Could not read the selected file'
                      showToast(msg, 'error')
                      alert(msg)
                      return
                    }
                    input.value = ''
                    const emptyReason = selectionFailureReason(filesArray)
                    if (emptyReason) {
                      logUploadSelection('selection-empty', { reason: emptyReason })
                      showToast(emptyReason, 'error')
                      alert(emptyReason)
                      return
                    }
                    const albumIdForUpload = openAlbumId
                    if (!albumIdForUpload) {
                      showToast('Open an album first, then upload.', 'error')
                      return
                    }
                    if (!user) {
                      showToast('Please sign in to upload.', 'error')
                      return
                    }
                    if (uploadLockRef.current) {
                      console.warn('UPLOAD: queueing additional files while others run')
                    }
                    if (!validateUploadFileSizes(filesArray)) return

                    logUploadSelection('album-input-confirmed', {
                      count: filesArray.length,
                      names: filesArray.map((f) => f.name),
                      sizes: filesArray.map((f) => f.size),
                      types: filesArray.map((f) => f.type || ''),
                    })

                    const optimisticUrls: string[] = []
                    const queueIds: string[] = []
                    const optimisticRows: FileRow[] = filesArray.map((f) => {
                      const isVid = /\.(mp4|m4v|mov|webm|mkv|ogv|ogg|qt)$/i.test(f.name) || f.type.startsWith('video/')
                      const url = isVid ? '' : URL.createObjectURL(f)
                      optimisticUrls.push(url)
                      const oid = `optimistic-${crypto.randomUUID()}`
                      queueIds.push(oid)
                      fileByQueueIdRef.current.set(oid, f)
                      const row: FileRow = {
                        id: oid,
                        user_id: user.id,
                        album_id: albumIdForUpload,
                        file_name: f.name,
                        file_url: url || 'pending://upload',
                        created_at: new Date().toISOString(),
                        file_size_bytes: f.size,
                        purpose: 'content',
                        is_encrypted: false,
                        mime_type: f.type || null,
                      }
                      optimisticRowByQueueIdRef.current.set(oid, row)
                      return row
                    })

                    try {
                    const queueItems: UploadQueueItem[] = queueIds.map((id, i) => ({
                      id,
                      name: filesArray[i]!.name,
                      size: filesArray[i]!.size,
                      type: filesArray[i]!.type || 'application/octet-stream',
                      progress: 0,
                      status: 'queued' as const,
                      error: null,
                    }))

                    setFiles((prev) => [...optimisticRows, ...prev])
                    setUploadQueueItems((prev) => [...queueItems, ...prev])
                    setUploading(true)
                    setUploadProgress(0)
                    setUploadFileName(filesArray[0]!.name)
                    setUploadBatchTotal(filesArray.length)
                    setUploadBatchIndex(1)
                    setUploadEtaText(null)
                    setUploadCurrentFilePercent(0)

                    uploadLockRef.current = true
                    void runAlbumUpload(filesArray, optimisticUrls, queueIds)
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Upload could not start after file selection'
                      showToast(msg, 'error')
                      alert(`Upload failed at selection: ${msg}`)
                    }
                  }}
                />
              </label>
              </div>
            </div>

            <UploadQueueOverlay
              visible={
                liveQueueItems.some((i) => i.status !== 'done') ||
                uploading ||
                uploadQueueItems.some((i) =>
                  ['queued', 'preparing', 'uploading', 'finalizing', 'retrying', 'failed'].includes(i.status),
                )
              }
              items={liveQueueItems.length ? liveQueueItems : uploadQueueItems}
              overallProgress={liveQueueItems.length ? liveTotals.percent : uploadProgress}
              etaText={liveQueueItems.length ? formatEta(liveTotals.etaSeconds) : uploadEtaText}
              currentFileIndex={liveQueueItems.length ? liveTotals.completed + (liveCurrent ? 1 : 0) : uploadBatchIndex}
              batchTotal={liveQueueItems.length ? liveTotals.total : uploadBatchTotal}
              currentFileName={liveQueueItems.length ? liveCurrent?.fileName ?? null : uploadFileName}
              currentFilePercent={
                liveQueueItems.length
                  ? liveCurrent
                    ? liveQueueItems.find((i) => i.id === liveCurrent.id)?.progress ?? null
                    : null
                  : uploadCurrentFilePercent
              }
              onRetry={(id) => {
                if (getLiveUploads().some((j) => j.id === id)) retryJob(id)
                else retryUploadQueueItem(id)
              }}
              onRetryAll={retryAllFailed}
              onPause={pauseJob}
              onResume={resumeJob}
              onCancel={(id) => void cancelJob(id)}
              onReselect={attachFileForResume}
              onDismiss={() => {
                dismissFailed()
                dismissFailedUploadQueue()
              }}
            />

            {openAlbum && !albumViewAllowed(openAlbum) ? (
              <div className="vault-empty">
                <p>This album is password-protected. Unlock it for this browser session.</p>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Album PIN / password"
                  value={unlockPin}
                  onChange={(e) => setUnlockPin(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={async () => {
                    const ok = await verifyAlbumPassword(openAlbum.id, unlockPin)
                    if (!ok) {
                      showToast('Wrong PIN', 'error')
                      return
                    }
                    setUnlockPin('')
                    setAlbumUnlocked((n) => n + 1)
                    showToast('Album unlocked for this session')
                  }}
                >
                  Unlock album
                </button>
              </div>
            ) : (
            <>
            <BulkActionBar
              count={albumSelected.size}
              albums={albums.map((a) => ({ id: a.id, name: a.name }))}
              currentAlbumId={openAlbumId}
              onClear={() => setAlbumSelected(new Set())}
              onSelectAll={() => setAlbumSelected(new Set(files.map((f) => f.id)))}
              onAddToAlbum={async (dest) => {
                if (!user) return
                await addFilesToAlbum(user.id, dest, [...albumSelected])
                showToast('Added to album (original stays in this album too)')
              }}
              onMoveToAlbum={async (dest) => {
                if (!user || !openAlbumId) return
                await moveFilesToAlbum(user.id, openAlbumId, dest, [...albumSelected])
                setFiles((prev) => prev.filter((f) => !albumSelected.has(f.id)))
                setAlbumSelected(new Set())
                showToast('Moved')
              }}
              onRemoveFromAlbum={async () => {
                if (!user || !openAlbumId) return
                await removeFilesFromAlbum(user.id, openAlbumId, [...albumSelected])
                setFiles((prev) => prev.filter((f) => !albumSelected.has(f.id)))
                setAlbumSelected(new Set())
                showToast('Removed from album')
              }}
              onFavorite={() => {}}
              onAddTags={() => showToast('Tag from Library')}
              onRemoveTags={() => {}}
              onDownload={() => {}}
              onDelete={async () => {
                if (!user || albumSelected.size === 0) return
                if (!window.confirm(`Move ${albumSelected.size} item(s) to Recently Deleted?`)) return
                await softDeleteFiles(user.id, [...albumSelected])
                setFiles((prev) => prev.filter((f) => !albumSelected.has(f.id)))
                setAlbumSelected(new Set())
                showToast('Moved to Recently Deleted')
              }}
            />
            {filesError ? (
            <div className="banner banner--error" role="alert">
              <strong>Could not load files.</strong> {filesError}
            </div>
            ) : null}

            {childAlbums.length > 0 || openAlbumId ? (
              <div className="nested-collections">
                <div className="row nested-collections__head">
                  <h3 className="nested-collections__title">Nested collections</h3>
                  <button type="button" className="btn btn--ghost" onClick={() => setCreateModalOpen(true)}>
                    + Nested
                  </button>
                </div>
                {childAlbums.length > 0 ? (
                  <ul className="nested-collections__list">
                    {childAlbums.map((a) => (
                      <li key={a.id}>
                        <button type="button" className="nested-collections__item" onClick={() => navigate(`/albums/${a.id}`)}>
                          <span>{a.name}</span>
                          <span className="muted">{a.itemCount} items</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No nested collections yet.</p>
                )}
              </div>
            ) : null}

            {filesLoading && files.length === 0 ? (
            <ul className="vault-grid vault-grid--gallery" style={{ ['--vault-gallery-cols' as string]: String(galleryCols) } as CSSProperties}>
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={`sk-${i}`} className="vault-photo-item">
                  <div className="vault-photo-tile">
                    <div className="vault-photo-tile__media vault-photo-tile__media--skeleton" />
                  </div>
                </li>
              ))}
            </ul>
            ) : files.length === 0 ? (
            <div className="vault-empty">No files in this album yet.</div>
            ) : (
            <>
            <ul
              className="vault-grid vault-grid--gallery"
              style={
                {
                  ['--vault-gallery-cols' as string]: String(galleryCols),
                } as CSSProperties
              }
            >
              {displayFiles.map((f) => {
                const isVideo = isVideoFileName(f.file_name)

                return (
                  <li
                    key={f.id}
                    className={`vault-photo-item ${albumSelected.has(f.id) ? 'is-selected' : ''}`}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const next = new Set(albumSelected)
                      if (next.has(f.id)) next.delete(f.id)
                      else next.add(f.id)
                      setAlbumSelected(next)
                    }}
                  >
                    <label className="vault-photo-item__check">
                      <input
                        type="checkbox"
                        checked={albumSelected.has(f.id)}
                        onChange={() => {
                          const next = new Set(albumSelected)
                          if (next.has(f.id)) next.delete(f.id)
                          else next.add(f.id)
                          setAlbumSelected(next)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="vault-photo-tile"
                      onClick={() => {
                        if (!openAlbumId) return
                        navigate(`/albums/${openAlbumId}/media/${f.id}`, { state: { sort: fileSort } })
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0]
                        longPressTouchStartRef.current = { x: t.clientX, y: t.clientY }
                        longPressTimerRef.current = setTimeout(() => {
                          setFileActionTarget(f)
                          longPressTimerRef.current = null
                        }, 520)
                      }}
                      onTouchMove={(e) => {
                        const start = longPressTouchStartRef.current
                        if (!start || !longPressTimerRef.current) return
                        const t = e.touches[0]
                        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 14) {
                          clearLongPress()
                        }
                      }}
                      onTouchEnd={clearLongPress}
                      onTouchCancel={clearLongPress}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setFileActionTarget(f)
                      }}
                      aria-label={`Open ${f.file_name}`}
                    >
                      <div className="vault-photo-tile__media">
                        {user ? (
                          <VaultPhotoTileMedia file={f} userId={user.id} />
                        ) : null}
                      </div>
                      {isVideo ? (
                        <span className="vault-photo-tile__video-glyph" aria-hidden title="Video">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7L8 5z" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="vault-photo-item__more"
                      aria-label={`Actions for ${f.file_name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFileActionTarget(f)
                      }}
                    >
                      ⋮
                    </button>
                  </li>
                )
              })}
            </ul>
            {filesHasMore ? (
              <div className="library-more">
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={filesLoading}
                  onClick={async () => {
                    if (!user || !openAlbumId) return
                    setFilesLoading(true)
                    try {
                      const page = await listAlbumMemberFiles(user.id, openAlbumId, {
                        offset: files.length,
                        limit: 48,
                      })
                      const rows = page.rows.filter(isGalleryFile) as FileRow[]
                      setFiles((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))])
                      setFilesHasMore(page.hasMore)
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : 'Could not load more', 'error')
                    } finally {
                      setFilesLoading(false)
                    }
                  }}
                >
                  {filesLoading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
            </>
            )}
            </>
            )}

            {fileActionTarget ? (
              <div
                className="modal-backdrop vault-action-backdrop"
                role="presentation"
                onClick={() => setFileActionTarget(null)}
              >
                <div
                  className="vault-action-sheet modal modal--enter"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="vault-file-actions-title"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <h2 id="vault-file-actions-title" className="vault-action-sheet__title">
                    {fileActionTarget.file_name}
                  </h2>
                  <div className="vault-action-sheet__list">
                    <a
                      className="vault-action-sheet__item"
                      href={fileActionMedia.downloadUrl ?? '#'}
                      download={fileActionTarget.file_name}
                      aria-disabled={!fileActionMedia.downloadUrl}
                      onClick={(e) => {
                        if (!fileActionMedia.downloadUrl) {
                          e.preventDefault()
                          return
                        }
                        setFileActionTarget(null)
                      }}
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      className="vault-action-sheet__item"
                      disabled={!fileActionTarget.file_url || !/^https?:\/\//i.test(fileActionTarget.file_url)}
                      onClick={async () => {
                        const stored = fileActionTarget.file_url
                        if (!stored || !/^https?:\/\//i.test(stored)) {
                          showToast('Private files have no public link', 'error')
                          return
                        }
                        try {
                          await navigator.clipboard.writeText(stored)
                          showToast('Legacy public link copied')
                        } catch {
                          showToast('Could not copy link', 'error')
                        }
                        setFileActionTarget(null)
                      }}
                    >
                      Copy public link
                    </button>
                    <button
                      type="button"
                      className="vault-action-sheet__item"
                      onClick={() => {
                        setFileInfoTarget(fileActionTarget)
                        setFileActionTarget(null)
                      }}
                    >
                      File details
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost vault-action-sheet__cancel"
                    onClick={() => setFileActionTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {fileInfoTarget ? (
              <div
                className="modal-backdrop"
                role="presentation"
                onClick={() => setFileInfoTarget(null)}
              >
                <div
                  className="modal modal--enter"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="vault-file-info-title"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <h2 id="vault-file-info-title" className="modal__title">
                    File details
                  </h2>
                  <dl className="vault-file-info-dl">
                    <div>
                      <dt>Name</dt>
                      <dd title={fileInfoTarget.file_name}>{fileInfoTarget.file_name}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{new Date(fileInfoTarget.created_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>
                        {fileInfoTarget.mime_type?.trim()
                          ? fileInfoTarget.mime_type
                          : isVideoFileName(fileInfoTarget.file_name)
                            ? 'Video'
                            : 'Image'}
                      </dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(fileInfoTarget.file_size_bytes ?? undefined)}</dd>
                    </div>
                  </dl>
                  <button type="button" className="btn btn--primary" onClick={() => setFileInfoTarget(null)}>
                    Done
                  </button>
                </div>
              </div>
            ) : null}

          </section>
        )}
      </main>
        </div>
      )}

      <CreateAlbumModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateAlbum}
        defaultParentId={openAlbumId}
        parentOptions={albums.map((a) => ({ id: a.id, name: a.name }))}
      />

      {moveTarget ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setMoveTarget(null)}>
          <div className="modal modal--enter" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Move “{moveTarget.name}”</h2>
            <p className="muted">Choose a parent collection. Cycles are blocked.</p>
            <select
              className="vault-sort-select"
              defaultValue={moveTarget.parent_album_id ?? ''}
              onChange={(e) => {
                const v = e.target.value
                void handleMoveCollection(moveTarget, v || null)
              }}
            >
              <option value="">Root (top level)</option>
              {albums
                .filter((a) => a.id !== moveTarget.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMoveTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RenameAlbumModal
        open={renameTarget !== null}
        initialName={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onRename={handleRename}
      />

      <ConfirmDeleteAlbumModal
        open={deleteTarget !== null}
        albumName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      {protectTarget ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setProtectTarget(null)}>
          <div className="modal modal--enter" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Album password / PIN</h2>
            <p className="dashboard__subtitle">Optional. Leave empty and remove to keep the album as it is today.</p>
            <input
              className="field-input"
              type="password"
              placeholder="New PIN (4+ characters)"
              value={protectPin}
              onChange={(e) => setProtectPin(e.target.value)}
            />
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setProtectTarget(null)}>
                Cancel
              </button>
              {protectTarget.is_protected || protectTarget.isProtected ? (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={async () => {
                    await clearAlbumPassword(protectTarget.id)
                    setProtectTarget(null)
                    await refreshAlbums()
                    showToast('Album protection removed')
                  }}
                >
                  Remove protection
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--primary"
                disabled={protectPin.trim().length < 4}
                onClick={async () => {
                  await setAlbumPassword(protectTarget.id, protectPin)
                  setProtectTarget(null)
                  setProtectPin('')
                  await refreshAlbums()
                  showToast('Album protection saved')
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AlbumCoverPickerModal
        open={coverPickerAlbum !== null}
        album={coverPickerAlbum}
        userId={user?.id ?? ''}
        onClose={() => setCoverPickerAlbum(null)}
        onSaved={async () => {
          await refreshAlbums()
          showToast('Album cover updated')
        }}
        onRemoved={async () => {
          await refreshAlbums()
          showToast('Cover removed')
        }}
      />
    </>
  )
}
