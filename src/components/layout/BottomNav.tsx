import { NavLink } from 'react-router-dom'

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      <div className="bottom-nav__inner">
        <NavLink
          to="/albums"
          className={({ isActive }) => `bottom-nav__link ${isActive ? 'is-active' : ''}`}
          end
        >
          <span className="bottom-nav__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="3" width="7" height="9" rx="1.2" />
              <rect x="14" y="3" width="7" height="5" rx="1.2" />
              <rect x="14" y="11" width="7" height="10" rx="1.2" />
              <rect x="3" y="15" width="7" height="6" rx="1.2" />
            </svg>
          </span>
          <span className="bottom-nav__label">Albums</span>
        </NavLink>

        <NavLink
          to="/upload"
          className={({ isActive }) => `bottom-nav__link bottom-nav__link--fab ${isActive ? 'is-active' : ''}`}
        >
          <span className="bottom-nav__fab" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
          <span className="bottom-nav__label">Upload</span>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) => `bottom-nav__link ${isActive ? 'is-active' : ''}`}
        >
          <span className="bottom-nav__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
            </svg>
          </span>
          <span className="bottom-nav__label">Settings</span>
        </NavLink>
      </div>
    </nav>
  )
}
