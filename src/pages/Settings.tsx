import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useVault } from '../context/useVault'
import { ConfirmLogoutModal } from '../components/ConfirmLogoutModal'

export function Settings() {
  const { user, signOut } = useAuth()
  const { status, setupVault, unlockVault, recoveryJustCreated, clearRecoveryDisplay } = useVault()
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleConfirmLogout() {
    setLogoutOpen(false)
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
      </header>

      <div className="settings-page__body">
        <section className="settings-section">
          <h2 className="settings-section__heading">Profile</h2>
          <div className="settings-section__card">
            <p className="settings-row__label">Email</p>
            <p className="settings-row__value" title={user?.email ?? undefined}>
              {user?.email ?? '—'}
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__heading">Vault encryption</h2>
          <div className="settings-section__card">
            <p className="settings-placeholder">
              New uploads can be encrypted in chunks after you create a recovery key. Existing media is never
              rewritten. If you lose every device, you need your login plus this recovery key.
            </p>
            <p className="settings-row__value">Status: {status}</p>
            {recoveryJustCreated ? (
              <div className="settings-recovery">
                <p>Save this recovery key now. It will not be shown again.</p>
                <code className="settings-recovery__key">{recoveryJustCreated}</code>
                <button type="button" className="btn btn--primary" onClick={clearRecoveryDisplay}>
                  I saved it
                </button>
              </div>
            ) : null}
            {status === 'missing' ? (
              <button
                type="button"
                className="btn btn--outline btn--block"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setMsg(null)
                  try {
                    await setupVault()
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : 'Could not create vault key')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Create recovery key
              </button>
            ) : null}
            {status === 'needs-unlock' ? (
              <>
                <input
                  className="field-input"
                  placeholder="Recovery key"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={busy || !recoveryInput.trim()}
                  onClick={async () => {
                    setBusy(true)
                    setMsg(null)
                    try {
                      await unlockVault(recoveryInput)
                      setRecoveryInput('')
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : 'Could not unlock')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Unlock vault
                </button>
              </>
            ) : null}
            {msg ? <p className="field-error">{msg}</p> : null}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__heading">Account</h2>
          <div className="settings-section__card">
            <button
              type="button"
              className="btn btn--danger btn--block settings-logout-btn"
              onClick={() => setLogoutOpen(true)}
            >
              Log out
            </button>
          </div>
        </section>
      </div>

      <ConfirmLogoutModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={handleConfirmLogout}
      />
    </div>
  )
}
