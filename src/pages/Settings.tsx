import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { ConfirmLogoutModal } from '../components/ConfirmLogoutModal'

export function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)

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
          <h2 className="settings-section__heading">App</h2>
          <div className="settings-section__card settings-section__card--muted">
            <p className="settings-placeholder">More options coming soon.</p>
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
