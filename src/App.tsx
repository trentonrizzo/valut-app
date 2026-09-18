import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthProvider'
import { VaultProvider } from './context/VaultProvider'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Dashboard } from './pages/Dashboard'
import { FullScreenMediaViewer } from './pages/FullScreenMediaViewer'
import { Settings } from './pages/Settings'
import { Upload } from './pages/Upload'
import { Library } from './pages/Library'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BootScreen } from './components/BootScreen'
import { supabaseConfigError } from './lib/supabase'

export default function App() {
  if (supabaseConfigError) {
    return (
      <BootScreen
        title="Vault cannot start"
        message={supabaseConfigError}
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <ErrorBoundary>
    <AuthProvider>
      <VaultProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<Navigate to="/albums" replace />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="albums" element={<Dashboard />} />
              <Route path="albums/:albumId" element={<Dashboard />}>
                <Route path="media/:fileId" element={<FullScreenMediaViewer />} />
              </Route>
              <Route path="library" element={<Library />} />
              <Route path="library/media/:fileId" element={<FullScreenMediaViewer />} />
              <Route path="upload" element={<Upload />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
      </VaultProvider>
    </AuthProvider>
    </ErrorBoundary>
  )
}
