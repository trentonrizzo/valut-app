import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useVault } from '../context/useVault'
import { ConfirmLogoutModal } from '../components/ConfirmLogoutModal'
import { clearVaultPin, setVaultPin, vaultPinIsSet, verifyVaultPin } from '../lib/vaultPin'
import { Link } from 'react-router-dom'
import { fetchVaultStorageStats, formatStorageLine, type VaultStorageStats } from '../lib/storageStats'
import { backfillCaptureDatesBatch, hashMissingBatch } from '../lib/mediaIndexBackfill'

export function Settings() {
  const { user, session, signOut } = useAuth()
  const { status, setupVault, unlockVault, recoveryJustCreated, clearRecoveryDisplay, masterKey } = useVault()
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pinSet, setPinSet] = useState(false)
  const [storage, setStorage] = useState<VaultStorageStats | null>(null)

  useEffect(() => {
    void vaultPinIsSet().then(setPinSet).catch(() => setPinSet(false))
  }, [])

  useEffect(() => {
    void fetchVaultStorageStats().then(setStorage).catch(() => setStorage(null))
  }, [])

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
          <h2 className="settings-section__heading">Vault PIN</h2>
          <div className="settings-section__card">
            <p className="settings-placeholder">
              Optional session PIN for locked items. This is not encryption. Status: {pinSet ? 'set' : 'not set'}
            </p>
            <input className="field-input" type="password" placeholder="PIN (4+)" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button
              type="button"
              className="btn btn--outline btn--block"
              onClick={async () => {
                try {
                  if (pinSet) {
                    const ok = await verifyVaultPin(pin)
                    setMsg(ok ? 'Session unlocked' : 'Wrong PIN')
                  } else {
                    await setVaultPin(pin)
                    setPinSet(true)
                    setMsg('PIN saved for this account')
                  }
                  setPin('')
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : 'PIN failed')
                }
              }}
            >
              {pinSet ? 'Unlock session' : 'Set PIN'}
            </button>
            {pinSet ? (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={async () => {
                  await clearVaultPin()
                  setPinSet(false)
                  setMsg('PIN removed')
                }}
              >
                Remove PIN
              </button>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__heading">Library</h2>
          <div className="settings-section__card settings-section__card--stack">
            <Link className="btn btn--outline btn--block" to="/favorites">
              Favorites
            </Link>
            <Link className="btn btn--outline btn--block" to="/duplicates">
              Duplicates
            </Link>
            <Link className="btn btn--outline btn--block" to="/deleted">
              Recently Deleted
            </Link>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={busy || !user || !session?.access_token}
              onClick={async () => {
                if (!user || !session?.access_token) return
                setBusy(true)
                setMsg(null)
                try {
                  let cursorCreatedAt: string | null = null
                  let cursorId: string | null = null
                  let hashed = 0
                  let failed = 0
                  let skipped = 0
                  for (let i = 0; i < 30; i++) {
                    const batch = await hashMissingBatch({
                      userId: user.id,
                      accessToken: session.access_token,
                      masterKey,
                      limit: 3,
                      cursorCreatedAt,
                      cursorId,
                    })
                    hashed += batch.hashed
                    failed += batch.failed
                    skipped += batch.skipped
                    cursorCreatedAt = batch.nextCursorCreatedAt
                    cursorId = batch.nextCursorId
                    if (batch.done) break
                  }
                  setMsg(
                    `Hash index: ${hashed} hashed, ${skipped} skipped, ${failed} failed (originals untouched). Open Duplicates as indexing proceeds.`,
                  )
                  void fetchVaultStorageStats().then(setStorage).catch(() => {})
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : 'Hash indexing failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Hash existing media (safe batch)
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={busy || !user || !session?.access_token}
              onClick={async () => {
                if (!user || !session?.access_token) return
                setBusy(true)
                setMsg(null)
                try {
                  let cursorCreatedAt: string | null = null
                  let cursorId: string | null = null
                  let updated = 0
                  let skipped = 0
                  let failed = 0
                  for (let i = 0; i < 20; i++) {
                    const batch = await backfillCaptureDatesBatch({
                      userId: user.id,
                      accessToken: session.access_token,
                      masterKey,
                      limit: 2,
                      cursorCreatedAt,
                      cursorId,
                    })
                    updated += batch.updated
                    skipped += batch.skipped
                    failed += batch.failed
                    cursorCreatedAt = batch.nextCursorCreatedAt
                    cursorId = batch.nextCursorId
                    if (batch.done) break
                  }
                  setMsg(
                    `Capture dates: ${updated} recovered, ${skipped} unknown/skipped, ${failed} failed (never guessed).`,
                  )
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : 'Capture backfill failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Recover capture dates (safe batch)
            </button>
            {msg ? <p className="settings-placeholder">{msg}</p> : null}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__heading">Storage</h2>
          <div className="settings-section__card">
            <p className="settings-row__value">{formatStorageLine(storage)}</p>
            <p className="settings-placeholder">
              Totals count each physical item once. Album sizes elsewhere are referenced membership totals and may
              overlap when the same item is in multiple albums. Uploads still use signed R2 URLs with verify-before-catalog.
            </p>
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
