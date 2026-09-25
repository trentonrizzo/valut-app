import { useEffect, useState } from 'react'
import type { FileRow } from '../../types/media'
import { formatBytes } from '../../lib/formatBytes'
import { loadMediaDetails, type MediaDetailsModel } from '../../lib/mediaDetails'
import { useAuth } from '../../context/useAuth'
import { useToast } from '../../context/useToast'
import { addTagsToFiles, removeTagsFromFiles } from '../../lib/tags'
import { TagPickerModal } from '../library/TagPickerModal'
import { setFavorite } from '../../lib/albumMembership'

type Props = {
  file: FileRow | null
  onClose: () => void
  onChanged?: () => void
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return 'Unknown'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m ${r}s` : `${r}s`
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

  const rows: { label: string; value: string }[] = [
    { label: 'Filename', value: file.file_name },
    {
      label: 'Original filename',
      value: String((file as FileRow & { original_filename?: string | null }).original_filename || file.file_name),
    },
    { label: 'Type', value: file.mime_type || 'Unknown' },
    { label: 'Original creation', value: fmtDate(file.captured_at) },
    { label: 'Vault import', value: fmtDate(file.created_at) },
    { label: 'Size', value: file.file_size_bytes != null ? formatBytes(file.file_size_bytes) : 'Unknown' },
    { label: 'Duration', value: fmtDuration(file.duration_ms) },
    {
      label: 'Dimensions',
      value: file.width && file.height ? `${file.width}×${file.height}` : 'Unknown',
    },
    { label: 'Resolution', value: model?.resolutionLabel || '—' },
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
