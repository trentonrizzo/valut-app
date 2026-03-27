import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppShell() {
  const { pathname } = useLocation()
  const hideBottomNav = /^\/albums\/[^/]+(\/media\/[^/]+)?$/.test(pathname)

  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <Outlet />
      </div>
      {!hideBottomNav ? <BottomNav /> : null}
    </div>
  )
}
