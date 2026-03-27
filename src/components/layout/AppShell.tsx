import { Outlet, useMatch } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppShell() {
  const inAlbumView = Boolean(useMatch({ path: '/albums/:albumId', end: true }))

  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <Outlet />
      </div>
      {!inAlbumView ? <BottomNav /> : null}
    </div>
  )
}
