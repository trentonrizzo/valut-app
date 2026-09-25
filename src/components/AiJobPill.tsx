import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import {
  cancelJob,
  listActiveJobs,
  listJobEvents,
  listRecentJobs,
  pauseJob,
  resumeJob,
  type AiJobRow,
} from '../lib/ai/jobs'

export function AiJobPill() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState<AiJobRow[]>([])
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<AiJobRow | null>(null)
  const [events, setEvents] = useState<{ id: number; message: string; created_at: string }[]>([])
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const refresh = async () => {
      const active = await listActiveJobs(user.id)
      const recent = await listRecentJobs(user.id, 8)
      if (cancelled) return
      setJobs(active.length ? active : recent.filter((j) => ['COMPLETED', 'PARTIAL', 'FAILED'].includes(j.status)).slice(0, 3))
      const justDone = recent.find((j) => j.status === 'COMPLETED' && j.completed_at)
      if (justDone?.result_summary && justDone.completed_at) {
        const age = Date.now() - new Date(justDone.completed_at).getTime()
        if (age < 15000) setToast(justDone.result_summary)
      }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [user])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 8000)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!user || !selected) return
    void listJobEvents(user.id, selected.id).then(setEvents)
  }, [user, selected, expanded])

  if (!user || (!jobs.length && !toast)) return null

  const running = jobs.filter((j) => ['QUEUED', 'RUNNING', 'PLANNING', 'WAITING'].includes(j.status))
  const primary = running[0] || jobs[0]

  return (
    <>
      {toast ? (
        <div className="vault-job-toast" role="status">
          {toast}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {primary ? (
        <button
          type="button"
          className="vault-job-pill"
          onClick={() => {
            setSelected(primary)
            setExpanded((v) => !v)
          }}
        >
          <span className="vault-job-pill__dot" aria-hidden />
          {running.length > 1
            ? `${running.length} AI jobs running`
            : `${primary.current_phase} · ${primary.progress_completed} / ${primary.progress_total || '—'}`}
        </button>
      ) : null}
      {expanded && selected ? (
        <div className="vault-job-sheet" role="dialog" aria-label="AI job status">
          <div className="vault-job-sheet__handle" />
          <header>
            <strong>{selected.request_text.slice(0, 80)}</strong>
            <button type="button" onClick={() => setExpanded(false)}>
              Collapse
            </button>
          </header>
          <p className="muted">
            {selected.status} · {selected.current_phase} · {selected.progress_completed}/{selected.progress_total}
          </p>
          <pre className="vault-job-sheet__log">
            {events.map((e) => `${e.message}`).join('\n') || 'No events yet.'}
          </pre>
          <div className="row">
            {['QUEUED', 'RUNNING'].includes(selected.status) ? (
              <button type="button" onClick={() => void pauseJob(user.id, selected.id)}>
                Pause
              </button>
            ) : null}
            {selected.status === 'PAUSED' ? (
              <button type="button" onClick={() => void resumeJob(user.id, selected.id)}>
                Resume
              </button>
            ) : null}
            {!['COMPLETED', 'CANCELED'].includes(selected.status) ? (
              <button type="button" onClick={() => void cancelJob(user.id, selected.id)}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
