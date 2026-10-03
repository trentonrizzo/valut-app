import { useEffect, useState } from 'react'
import type { FileRow } from '../../types/media'
import { formatBytesExact } from '../../lib/formatBytes'
import { loadMediaDetails, type MediaDetailsModel } from '../../lib/mediaDetails'
import { useAuth } from '../../context/useAuth'
import { useToast } from '../../context/useToast'
import { addTagsToFiles, removeTagsFromFiles } from '../../lib/tags'
import { TagPickerModal } from '../library/TagPickerModal'
import { setFavorite } from '../../lib/albumMembership'
import { isVideoMime } from '../../lib/mediaTypes'
import { calculateOverallBitrate, type TechnicalMediaMetadata } from '../../lib/upload/technicalMetadata'

type Props = {
  file: FileRow | null
  onClose: () => void
  onChanged?: () => void
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return 'Unknown'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function fmtCaptured(file: FileRow): string {
  if (file.captured_at) return fmtDate(file.captured_at)
  if (file.captured_at_local) {
    const display = file.captured_at_local.replace('T', ' ')
    return `${display}${file.captured_at_offset ? ` ${file.captured_at_offset}` : ' (timezone unknown)'}`
  }
  return 'Unknown'
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function technical(file: FileRow): TechnicalMediaMetadata | null {
  const value = file.metadata_json?.technicalMetadata
  return value && typeof value === 'object' ? value as TechnicalMediaMetadata : null
}

function sourceSize(file: FileRow): number | null {
  const value = file.metadata_json?.sourceSizeBytes
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : file.file_size_bytes
}

function fmtRate(value: number | null | undefined): string {
  return value && Number.isFinite(value) ? `${Number(value.toFixed(3))} fps` : 'Unknown'
}

function fmtBitrate(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return 'Unknown'
  return `~${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)} Mbps (overall file bitrate)`
}

function integrityLabel(file: FileRow): string {
  const evidence = file.metadata_json?.integrityEvidence
  const expected = evidence && typeof evidence === 'object'
    ? (evidence as { expectedStoredBytes?: unknown }).expectedStoredBytes
    : null
  const verified = evidence && typeof evidence === 'object'
    ? (evidence as { verifiedStoredBytes?: unknown }).verifiedStoredBytes
    : null
  if (evidence && typeof evidence === 'object'
    && (evidence as { method?: unknown }).method === 'r2_head_size'
    && typeof expected === 'number'
    && Number.isSafeInteger(expected)
    && expected >= 0
    && expected === verified) {
    return 'Verified (stored object exists and size matches)'
  }
  if (file.storage_integrity === 'missing') return 'Missing'
  if (file.storage_integrity === 'problem') return 'Problem'
  if (file.upload_status === 'ready') return 'Upload complete'
  return 'Unknown'
}

export function MediaDetailsSheet({ file, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [model, setModel] = useState<MediaDetailsModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tagModal, setTagModal] = useState<'add' | 'remove' | null>(null)
  const [favorite, setFavoriteLocal] = useState(false)

  useEffect(() => {
    if (!file || !user) {
      setModel(null)
      return
    }
    setFavoriteLocal(Boolean(file.favorite))
    let cancelled = false
    setError(null)
    void loadMediaDetails(user.id, file)
      .then((m) => {
        if (!cancelled) setModel(m)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load details')
      })
    return () => {
      cancelled = true
    }
  }, [file, user])

  if (!file) return null

  const tech = technical(file)
  const video = isVideoMime(file.mime_type, file.file_name)
  const width = file.width ?? tech?.width ?? null
  const height = file.height ?? tech?.height ?? null
  const durationMs = file.duration_ms ?? tech?.durationMs ?? null
  const selectedSize = sourceSize(file)
  const bitrate = tech?.overallBitrateBps ?? calculateOverallBitrate(selectedSize ?? -1, durationMs)

  const rows: { label: string; value: string }[] = [
    { label: 'Filename', value: file.file_name },
    {
      label: 'Original filename',
      value: String((file as FileRow & { original_filename?: string | null }).original_filename || file.file_name),
    },
    { label: 'Created', value: fmtCaptured(file) },
    { label: 'Uploaded', value: fmtDate(file.created_at) },
    ...(video ? [
      { label: 'Duration', value: fmtDuration(durationMs) },
      { label: 'Resolution', value: width && height ? `${width} × ${height}` : 'Unknown' },
      { label: 'Video codec', value: tech?.videoCodec || 'Unknown' },
      { label: 'Container', value: tech?.container || 'Unknown' },
      { label: 'MIME type', value: file.mime_type || 'Unknown' },
      { label: 'Frame rate', value: fmtRate(tech?.frameRate) },
      { label: 'Overall bitrate', value: fmtBitrate(bitrate) },
      { label: 'Audio codec', value: tech?.audioCodec || 'Unknown' },
    ] : [
      { label: 'Resolution', value: width && height ? `${width} × ${height}` : 'Unknown' },
      { label: 'Format', value: tech?.format || file.mime_type?.replace(/^image\//, '').toUpperCase() || 'Unknown' },
      { label: 'MIME type', value: file.mime_type || 'Unknown' },
    ]),
    { label: 'Original selected size', value: formatBytesExact(selectedSize) },
    { label: 'Stored object size', value: formatBytesExact(file.stored_size_bytes) },
    { label: 'Upload integrity', value: integrityLabel(file) },
    { label: 'Aspect ratio', value: model?.aspectRatio || '—' },
    { label: 'Favorite', value: favorite ? 'Yes' : 'No' },
    { label: 'Duplicate', value: model?.duplicateHint || 'Not indexed / unique' },
    {
      label: 'Source URL',
      value: String((file as FileRow & { source_url?: string | null }).source_url || '—'),
    },
    {
      label: 'Description',
      value: String((file as FileRow & { description?: string | null }).description || '—'),
    },
  ]

  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close details" onClick={onClose} />
      <div className="sheet sheet--details" role="dialog" aria-label="Media details">
        <div className="sheet__handle" />
        <h2 className="sheet__title">Details</h2>
        {error ? <p className="settings-placeholder">{error}</p> : null}
        <dl className="media-details">
          {rows.map((row) => (
            <div key={row.label} className="media-details__row">
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
          <div className="media-details__row">
            <dt>Albums</dt>
            <dd>
              {model?.albums?.length
                ? model.albums.map((a) => a.name).join(', ')
                : model
                  ? 'None'
                  : '…'}
            </dd>
          </div>
          <div className="media-details__row">
            <dt>Tags</dt>
            <dd className="media-details__tags">
              {model?.tags?.length ? (
                <div className="tag-chip-row">
                  {model.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="filter-chip"
                      onClick={() => {
                        if (!user) return
                        void removeTagsFromFiles(user.id, [file.id], [t.id])
                          .then(() => {
                            setModel((m) => (m ? { ...m, tags: m.tags.filter((x) => x.id !== t.id) } : m))
                            showToast(`Removed “${t.name}”`)
                            onChanged?.()
                          })
                          .catch((e) => showToast(e instanceof Error ? e.message : 'Remove failed', 'error'))
                      }}
                      aria-label={`Remove tag ${t.name}`}
                    >
                      {t.name} ×
                    </button>
                  ))}
                </div>
              ) : model ? (
                'None'
              ) : (
                '…'
              )}
            </dd>
          </div>
        </dl>
        <div className="sheet__stack">
          <button type="button" className="btn btn--outline" onClick={() => setTagModal('add')}>
            + Add tags
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              if (!user) return
              const next = !favorite
              void setFavorite(user.id, [file.id], next)
                .then(() => {
                  setFavoriteLocal(next)
                  showToast(next ? 'Favorited' : 'Unfavorited')
                  onChanged?.()
                })
                .catch((e) => showToast(e instanceof Error ? e.message : 'Favorite failed', 'error'))
            }}
          >
            {favorite ? 'Unfavorite' : 'Favorite'}
          </button>
          <button type="button" className="btn btn--outline btn--block" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <TagPickerModal
        open={tagModal !== null}
        userId={user?.id ?? ''}
        mode={tagModal ?? 'add'}
        onClose={() => setTagModal(null)}
        onApply={async (tagIds) => {
          if (!user) return
          try {
            await addTagsToFiles(user.id, [file.id], tagIds)
            const refreshed = await loadMediaDetails(user.id, file)
            setModel(refreshed)
            setTagModal(null)
            showToast('1 item tagged')
            onChanged?.()
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Tag failed', 'error')
          }
        }}
      />
    </div>
  )
}
