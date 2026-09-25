import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useMediaSelection } from '../context/SelectionContext'
import { runDeterministicVaultAgent } from '../lib/ai/vaultTools'
import { createAiJobFromToolResult, processJobChunk } from '../lib/ai/jobs'
import { AiJobPill } from './AiJobPill'

type Msg = { role: 'user' | 'assistant'; text: string }

export function VaultAiAgent() {
  const { user, session } = useAuth()
  const { selectedFileIds } = useMediaSelection()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [messages, setMessages] = useState<Msg[]>(() => [
    {
      role: 'assistant',
      text: 'Vault AI organizes your library with the same tools as the app. Try: Create album… · Open Favorites · Create tag… · Show storage. Visual analysis needs an API key.',
    },
  ])
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const touchStart = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  // Resume unfinished jobs in the background while app is open (chunked, persisted).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return
      try {
        const { listActiveJobs } = await import('../lib/ai/jobs')
        const jobs = await listActiveJobs(user.id)
        for (const job of jobs.slice(0, 2)) {
          if (cancelled) break
          await processJobChunk(user.id, job.id, session?.access_token)
        }
      } catch {
        /* table may not exist yet */
      }
    }
    const id = window.setInterval(() => void tick(), 4000)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [user, session?.access_token])

  if (!user) return null

  async function send(text: string) {
    const prompt = text.trim()
    if (!prompt || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: prompt }])
    setBusy(true)
    try {
      const albumMatch = location.pathname.match(/^\/albums\/([^/]+)/)
      const local = await runDeterministicVaultAgent(user!.id, prompt, {
        accessToken: session?.access_token,
        uiScope: {
          albumId: albumMatch?.[1] || null,
          path: location.pathname,
          selectedFileIds,
        },
      })

      // Persist org jobs when requested
      for (const r of local.results) {
        if (r.tool === 'create_org_job' && r.ok) {
          const job = await createAiJobFromToolResult(user!.id, prompt, r.data as Record<string, unknown>)
          if (job) {
            local.reply = `${local.reply}\n\nStarted background job · ${job.current_phase} · 0 / ${job.progress_total || '?'}`
          }
        }
      }

      for (const path of local.navigations) {
        if (path.startsWith('/')) navigate(path)
      }

      let reply = local.reply
      const toolOk = local.results.some((r) => r.ok)
      const asksHelp = /\b(help|what can you do|capabilities|commands)\b/i.test(prompt)
      // Paid chat is suggestions-only. Never let it replace deterministic tool results or
      // drown create/open commands in a generic capability paragraph.
      if (session?.access_token && local.results.length === 0 && !toolOk && asksHelp) {
        try {
          const res = await fetch('/api/ai', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: 'chat',
              prompt,
              history: messages.filter((m) => m.role === 'user').slice(-4),
            }),
          })
          if (res.ok) {
            const body = (await res.json()) as { reply?: string }
            if (body.reply) reply = body.reply
          }
        } catch {
          /* keep deterministic */
        }
      }
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong.' },
      ])
    } finally {
      setBusy(false)
    }
  }

  function startVoice() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognition
      webkitSpeechRecognition?: new () => SpeechRecognition
    }
    type SpeechRecognition = {
      lang: string
      interimResults: boolean
      onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
      onerror: (() => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Voice input is not available in this browser.' }])
      return
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.onresult = (ev) => {
      const said = ev.results[0]?.[0]?.transcript || ''
      if (said) void send(said)
    }
    rec.onerror = () => undefined
    rec.onend = () => {
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    rec.start()
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = e.touches[0]?.clientY ?? null
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStart.current == null) return
    const dy = (e.touches[0]?.clientY ?? touchStart.current) - touchStart.current
    if (dy > 0) setDragY(dy)
  }
  function onTouchEnd() {
    if (dragY > 90) setOpen(false)
    setDragY(0)
    touchStart.current = null
  }

  return (
    <>
      <AiJobPill />
      {!open ? (
        <button type="button" className="vault-ai-fab" onClick={() => setOpen(true)} aria-label="Open Vault AI">
          AI
        </button>
      ) : null}
      {open ? (
        <div className="vault-ai-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            ref={sheetRef}
            className="vault-ai-sheet"
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            role="dialog"
            aria-label="Vault AI"
          >
            <div className="vault-ai-sheet__handle" aria-hidden />
            <header className="vault-ai-sheet__head">
              <strong>Vault AI</strong>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            <div className="vault-ai-sheet__msgs">
              {messages.map((m, i) => (
                <div key={`${m.role}-${i}`} className={`vault-ai-msg vault-ai-msg--${m.role}`}>
                  {m.text}
                </div>
              ))}
            </div>
            <form
              className="vault-ai-sheet__form"
              onSubmit={(e) => {
                e.preventDefault()
                void send(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Vault AI…"
                aria-label="Vault AI prompt"
                disabled={busy}
              />
              <button type="button" onClick={startVoice} disabled={busy}>
                Mic
              </button>
              <button type="submit" disabled={busy || !input.trim()}>
                {busy ? '…' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
