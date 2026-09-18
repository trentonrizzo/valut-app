import { useEffect, useState } from 'react'
import { createTag, listTags } from '../../lib/tags'

type Props = {
  open: boolean
  userId: string
  mode: 'add' | 'remove'
  onClose: () => void
  onApply: (tagIds: string[]) => void | Promise<void>
}

export function TagPickerModal({ open, userId, mode, onClose, onApply }: Props) {
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setQ('')
    setError(null)
    void listTags(userId).then(setTags).catch((e) => setError(e instanceof Error ? e.message : 'Could not load tags'))
  }, [open, userId])

  if (!open) return null
  const filtered = tags.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal modal--enter" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{mode === 'add' ? 'Add tags' : 'Remove tags'}</h2>
        <input className="field-input" placeholder="Search tags" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="tag-picker__list">
          {filtered.map((t) => (
            <li key={t.id}>
              <label className="tag-picker__row">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => {
        const next = new Set(selected)
        if (next.has(t.id)) next.delete(t.id)
        else next.add(t.id)
        setSelected(next)
                  }}
                />
                {t.name}
              </label>
            </li>
          ))}
        </ul>
        {mode === 'add' ? (
          <div className="tag-picker__create">
            <input
              className="field-input"
              placeholder="Create new tag"
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--outline"
              onClick={async () => {
                try {
                  const t = await createTag(userId, creating)
                  setTags((prev) => [...prev, t])
                  setSelected(new Set(selected).add(t.id))
                  setCreating('')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not create tag')
                }
              }}
              disabled={!creating.trim()}
            >
              Create
            </button>
          </div>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        <div className="modal__actions modal__actions--split">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.size === 0}
            onClick={() => void onApply([...selected])}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
