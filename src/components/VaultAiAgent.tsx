import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { runDeterministicVaultAgent } from '../lib/ai/vaultTools'

type Msg = { role: 'user' | 'assistant'; text: string }

export function VaultAiAgent() {
  const { user, session } = useAuth()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: 'Vault AI can organize with tags, albums, favorites, duplicates, and storage stats. Visual analysis needs a configured API key.',
    },
  ])
  const recognitionRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  if (!user) return null

  async function send(text: string) {
    const prompt = text.trim()
    if (!prompt || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: prompt }])
    setBusy(true)
    try {
      // Always run controlled Vault tools for actionable prompts (never skip for LLM chat).
      const local = await runDeterministicVaultAgent(user!.id, prompt, {
        accessToken: session?.access_token,
      })
      let reply = local.reply
      // Optional LLM enrichment when tools did not already execute a plan (or as commentary).
      if (session?.access_token && local.results.length === 0) {
        try {
          const res = await fetch('/api/ai', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ action: 'chat', prompt, history: messages.slice(-6) }),
          })
          if (res.ok) {
            const body = (await res.json()) as { reply?: string }
            if (body.reply) reply = body.reply
          }
        } catch {
          /* keep deterministic reply */
        }
      } else if (session?.access_token && local.results.length > 0) {
        try {
          const res = await fetch('/api/ai', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: 'chat',
              prompt: `User asked: ${prompt}\nTool results:\n${local.reply}\nBriefly confirm what was done. Do not invent deletions.`,
              history: [],
            }),
          })
          if (res.ok) {
            const body = (await res.json()) as { reply?: string }
            if (body.reply) reply = `${local.reply}\n\n${body.reply}`
          }
        } catch {
          /* keep tool reply */
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
      SpeechRecognition?: new () => {
        lang: string
        interimResults: boolean
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
      webkitSpeechRecognition?: new () => {
        lang: string
        interimResults: boolean
        onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
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
      const text = ev.results[0]?.[0]?.transcript
      if (text) void send(text)
    }
    rec.onerror = () => {
      recognitionRef.current = null
    }
    rec.onend = () => {
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    rec.start()
  }

  return (
    <>
      <button
        type="button"
        className="vault-ai-fab"
        aria-label="Open Vault AI"
        onClick={() => setOpen(true)}
      >
        AI
      </button>
      {open ? (
        <div className="sheet-root vault-ai-sheet">
          <button type="button" className="sheet-backdrop" aria-label="Close AI" onClick={() => setOpen(false)} />
          <div className="sheet" role="dialog" aria-label="Vault AI">
            <div className="sheet__handle" />
            <h2 className="sheet__title">Vault AI</h2>
            <div className="vault-ai-chat">
              {messages.map((m, i) => (
                <p key={`${m.role}-${i}`} className={`vault-ai-msg vault-ai-msg--${m.role}`}>
                  {m.text}
                </p>
              ))}
            </div>
            <div className="vault-ai-compose">
              <input
                className="field-input"
                value={input}
                placeholder="Ask Vault to organize…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send(input)
                }}
                disabled={busy}
              />
              <button type="button" className="btn btn--outline" onClick={() => startVoice()} disabled={busy}>
                Voice
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void send(input)} disabled={busy || !input.trim()}>
                {busy ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
