import { useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { captureBreakInFrame, enableBreakInCamera } from '../../lib/breakInCamera'
import {
  changeVaultPin,
  lockVaultSession,
  recoverVaultPin,
  setVaultPin,
  vaultLockStatus,
  verifyVaultPin,
} from '../../lib/vaultPin'
import { genericPinFailure, PIN_DOTS } from '../../lib/vaultLockPolicy'

type Phase = 'checking' | 'setup' | 'locked' | 'open' | 'codes'

export function VaultLockGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [codes, setCodes] = useState<string[]>([])
  const [server, setServer] = useState(false)
  const phaseRef = useRef(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    let cancel = false
    void supabase.rpc('vault_lock_now')
    void vaultLockStatus().then((status) => {
      if (cancel) return
      setServer(status.serverEnforced)
      setPhase(status.pinSet ? 'locked' : 'setup')
    }).catch(() => {
      if (!cancel) setPhase('locked')
    })
    const lock = () => {
      setPhase((current) => (current === 'setup' || current === 'codes' ? current : 'locked'))
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        lockVaultSession()
        lock()
      }
    }
    const onPageHide = () => {
      lockVaultSession()
      lock()
    }
    const onShow = () => {
      if (phaseRef.current === 'open') {
        lockVaultSession()
        lock()
      }
    }
    window.addEventListener('vault-lock', lock)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      cancel = true
      window.removeEventListener('vault-lock', lock)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onShow)
    }
  }, [])

  if (phase === 'open') return <>{children}</>

  return (
    <div className="pin-lock" role="dialog" aria-label="Vault lock">
      {phase === 'checking' ? <p className="pin-lock__hint">Enter six-digit PIN</p> : null}
      {phase === 'setup' ? (
        <PinSetup
          onCreated={(next) => {
            setCodes(next)
            setPhase(next.length ? 'codes' : 'locked')
          }}
        />
      ) : null}
      {phase === 'codes' ? (
        <div className="pin-lock__card">
          <h1>Save recovery codes</h1>
          <p>Each code works once and does not change your encrypted files. Store them somewhere private.</p>
          <ul className="pin-lock__codes">{codes.map((code) => <li key={code}>{code}</li>)}</ul>
          <button type="button" className="btn btn--primary btn--block" onClick={() => setPhase('locked')}>I saved these codes</button>
        </div>
      ) : null}
      {phase === 'locked' ? (
        <PinEntry
          server={server}
          onUnlock={() => setPhase('open')}
        />
      ) : null}
    </div>
  )
}

function Dots({ count, shake }: { count: number; shake: boolean }) {
  return (
    <div className={`pin-lock__dots${shake ? ' pin-lock__dots--shake' : ''}`} aria-hidden>
      {Array.from({ length: PIN_DOTS }, (_, i) => (
        <span key={i} className={i < count ? 'is-filled' : ''} />
      ))}
    </div>
  )
}

function Keypad({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: (next: string) => void
}) {
  function press(digit: string) {
    const next = `${value}${digit}`.slice(0, PIN_DOTS)
    onChange(next)
    if (next.length === PIN_DOTS) onSubmit(next)
  }
  return (
    <div className="pin-lock__pad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
        <button key={digit} type="button" className="pin-lock__key" onClick={() => press(digit)}>{digit}</button>
      ))}
      <button type="button" className="pin-lock__key" aria-label="Delete" onClick={() => onChange(value.slice(0, -1))}>⌫</button>
      <button type="button" className="pin-lock__key" onClick={() => press('0')}>0</button>
      <button type="button" className="pin-lock__key pin-lock__key--ok" aria-label="Submit PIN" onClick={() => onSubmit(value)}>✓</button>
    </div>
  )
}

function PinEntry({ server, onUnlock }: { server: boolean; onUnlock: () => void }) {
  const [value, setValue] = useState('')
  const [shake, setShake] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(next: string) {
    if (busy || next.length < 1) return
    setBusy(true)
    const result = await verifyVaultPin(next)
    setBusy(false)
    if (result.ok) {
      onUnlock()
      return
    }
    setValue('')
    setShake(true)
    setMessage(result.retryAt ? 'Try again later' : genericPinFailure())
    window.setTimeout(() => setShake(false), 450)
    void recordMiss()
  }

  return (
    <div className="pin-lock__card">
      <div className="pin-lock__mark" aria-hidden>◉</div>
      <h1>Enter six-digit PIN</h1>
      <Dots count={value.length} shake={shake} />
      <p className="pin-lock__hint">{message || (server ? 'Private vault' : 'Private vault')}</p>
      <Keypad value={value} onChange={setValue} onSubmit={(next) => void submit(next)} />
    </div>
  )
}

async function recordMiss() {
  const status = await vaultLockStatus()
  if (!status.breakinEnabled) return
  const shot = await captureBreakInFrame()
  const image = 'image' in shot ? shot.image : null
  await supabase.rpc('vault_record_breakin', {
    p_status: image ? 'captured' : 'unavailable',
    p_user_agent: navigator.userAgent.slice(0, 300),
    p_image: image,
  })
}

function PinSetup({ onCreated }: { onCreated: (codes: string[]) => void }) {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [stage, setStage] = useState<'create' | 'confirm'>('create')
  const [warn, setWarn] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function finish(confirmed: string) {
    if (confirmed !== first) {
      setSecond('')
      setMessage('Those PINs did not match')
      return
    }
    try {
      const codes = await setVaultPin(confirmed, warn || confirmed.length === 6)
      onCreated(codes)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save PIN')
    }
  }

  const current = stage === 'create' ? first : second
  return (
    <div className="pin-lock__card">
      <div className="pin-lock__mark" aria-hidden>◉</div>
      <h1>{stage === 'create' ? 'Create a PIN' : 'Confirm PIN'}</h1>
      <p className="pin-lock__hint">Enter six-digit PIN</p>
      <Dots count={current.length} shake={false} />
      {message ? <p className="pin-lock__hint">{message}</p> : null}
      {stage === 'create' && !warn ? (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setWarn(true)}>
          Use a shorter PIN
        </button>
      ) : null}
      {warn ? <p className="pin-lock__hint">Pins shorter than 6 digits are much easier to guess. Repeated attempts are still locked out.</p> : null}
      <Keypad
        value={current}
        onChange={stage === 'create' ? setFirst : setSecond}
        onSubmit={(next) => {
          if (next.length < 6 && !warn) {
            setMessage('Pins shorter than 6 digits are much easier to guess.')
            return
          }
          if (stage === 'create') {
            setStage('confirm')
            setMessage(null)
            return
          }
          void finish(next)
        }}
      />
    </div>
  )
}

export function VaultSecuritySettings() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [warn, setWarn] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [server, setServer] = useState(false)
  const [rows, setRows] = useState<Array<{ id: string; created_at: string; capture_status: string; user_agent: string | null; image_base64: string | null }>>([])

  useEffect(() => {
    void vaultLockStatus().then((status) => {
      setEnabled(status.breakinEnabled)
      setServer(status.serverEnforced)
    })
    void supabase.rpc('vault_breakin_history').then(({ data }) => {
      if (Array.isArray(data)) setRows(data as typeof rows)
    })
  }, [])

  return (
    <section className="settings-section">
      <h2 className="settings-section__heading">Security</h2>
      <div className="settings-section__card settings-section__card--stack">
        <p className="settings-placeholder">
          The application PIN is separate from account login and from file encryption. A 1–2 digit PIN is a convenience mode with lockouts, not six-digit security.
          {server ? ' Server enforcement is active.' : ' Server enforcement activates after the security migration is applied.'}
        </p>
        <button type="button" className="btn btn--outline btn--block" onClick={() => lockVaultSession()}>Lock Vault Now</button>
        <h3 className="settings-section__heading">Change PIN</h3>
        <input className="field-input" inputMode="numeric" placeholder="Current PIN" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="field-input" inputMode="numeric" placeholder="New PIN" value={next} onChange={(e) => setNext(e.target.value)} />
        {!warn ? <button type="button" className="btn btn--ghost btn--block" onClick={() => setWarn(true)}>Allow a shorter new PIN</button> : null}
        <button
          type="button"
          className="btn btn--outline btn--block"
          onClick={() => {
            void changeVaultPin(current, next, warn || next.replace(/\D/g, '').length === 6).then((ok) => {
              setMsg(ok ? 'PIN updated. Unlock again with the new PIN.' : genericPinFailure())
              if (ok) {
                setCurrent('')
                setNext('')
              }
            }).catch(() => setMsg(genericPinFailure()))
          }}
        >
          Change PIN
        </button>
        <h3 className="settings-section__heading">Recovery code</h3>
        <input className="field-input" placeholder="One-time recovery code" value={recovery} onChange={(e) => setRecovery(e.target.value)} />
        <button
          type="button"
          className="btn btn--outline btn--block"
          onClick={() => {
            void recoverVaultPin(recovery, next, warn || next.replace(/\D/g, '').length === 6).then((ok) => {
              setMsg(ok ? 'PIN replaced with the recovery code. Encrypted files were not changed.' : genericPinFailure())
            }).catch(() => setMsg(genericPinFailure()))
          }}
        >
          Use recovery code
        </button>
        <h3 className="settings-section__heading">Break-in Attempts</h3>
        <p className="settings-placeholder">Optional. Off by default. A photo is attempted only after you allow the camera and only when a PIN is wrong.</p>
        <button
          type="button"
          className="btn btn--outline btn--block"
          onClick={() => {
            void enableBreakInCamera().then(async (ok) => {
              if (!ok) {
                setMsg('Camera permission was not granted.')
                setEnabled(false)
                return
              }
              await supabase.rpc('vault_set_breakin', { p_enabled: true })
              setEnabled(true)
              setMsg('Break-in camera enabled.')
            })
          }}
        >
          {enabled ? 'Break-in camera enabled' : 'Enable break-in camera'}
        </button>
        {enabled ? (
          <button type="button" className="btn btn--ghost btn--block" onClick={() => {
            void supabase.rpc('vault_set_breakin', { p_enabled: false })
            setEnabled(false)
          }}>Turn off break-in camera</button>
        ) : null}
        {rows.map((row) => (
          <article key={row.id} className="pin-lock__attempt">
            <p>{new Date(row.created_at).toLocaleString()}</p>
            <p>{row.capture_status === 'captured' ? 'Photo captured' : 'Capture unavailable'}</p>
            <p>{row.user_agent || 'Device unknown'}</p>
            {row.image_base64 ? <img src={row.image_base64} alt="Break-in attempt" /> : null}
            <button type="button" className="btn btn--ghost" onClick={() => {
              void supabase.rpc('vault_delete_breakin', { p_id: row.id })
              setRows((list) => list.filter((item) => item.id !== row.id))
            }}>Remove</button>
          </article>
        ))}
        {msg ? <p className="settings-placeholder">{msg}</p> : null}
      </div>
    </section>
  )
}
