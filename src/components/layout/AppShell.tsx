import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { VaultAiAgent } from '../VaultAiAgent'
import { browserCapabilities } from '../../lib/browserCapabilities'

export function AppShell() {
  const { pathname, search } = useLocation()
  const pickerOpen = pathname.startsWith('/editor/') && new URLSearchParams(search).get('picker') === '1'
  const hideBottomNav =
    /^\/albums\/[^/]+(\/media\/[^/]+)?$/.test(pathname) || /^\/library\/media\/[^/]+$/.test(pathname)

  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <Outlet />
      </div>
      {!hideBottomNav ? <BottomNav /> : null}
      {!pickerOpen && !browserCapabilities.isLegacyMode ? <VaultAiAgent /> : null}
    </div>
  )
}
