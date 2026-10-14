import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { HouseLoader } from '@components/HouseLoader'

const pageLoaders: Array<() => Promise<unknown>> = []

const lazyPage = <K extends string>(
  load: () => Promise<Record<K, React.ComponentType>>,
  name: K,
) => {
  pageLoaders.push(load)
  return React.lazy(() => load().then((m) => ({ default: m[name] })))
}

const Login = lazyPage(() => import('@pages/Login'), 'Login')
const Register = lazyPage(() => import('@pages/Register'), 'Register')
const Dashboard = lazyPage(() => import('@pages/Dashboard'), 'Dashboard')
const RoomSettings = lazyPage(() => import('@pages/RoomSettings'), 'RoomSettings')
const UserSettings = lazyPage(() => import('@pages/UserSettings'), 'UserSettings')
const ListPage = lazyPage(() => import('@pages/ListPage'), 'ListPage')
const ListsIndex = lazyPage(() => import('@pages/ListsIndex'), 'ListsIndex')

const RequireAuth: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { isAuthed } = useAuth()
  const loc = useLocation()
  if (!isAuthed) {
    return <Navigate to="/login" state={{ from: loc }} replace />
  }
  return <>{children}</>
}

const RequireGuest: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { isAuthed } = useAuth()
  if (isAuthed) {
    return <Navigate to="/app" replace />
  }
  return <>{children}</>
}

// Warm the other route chunks once the browser is idle, so a navigation never has to wait on
// a network fetch (and a view transition never snapshots a loading state).
const prefetchPages = () => {
  for (const load of pageLoaders) load().catch(() => {})
}

export const AppRoutes: React.FC = () => {
  React.useEffect(() => {
    const idle = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined
    const id = idle ? idle(prefetchPages) : window.setTimeout(prefetchPages, 1500)
    return () => {
      if (idle) (window as any).cancelIdleCallback?.(id)
      else window.clearTimeout(id)
    }
  }, [])
  return (
    <main>
      <React.Suspense
        fallback={
          <div className="container" aria-busy="true" data-route-fallback>
            <div className="route-skeleton">
              <HouseLoader label="Loading" />
            </div>
          </div>
        }
      >
        <Routes>
          <Route
            path="/login"
            element={
              <RequireGuest>
                <Login />
              </RequireGuest>
            }
          />
          <Route
            path="/register"
            element={
              <RequireGuest>
                <Register />
              </RequireGuest>
            }
          />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/app/lists/:listId"
            element={
              <RequireAuth>
                <ListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/lists"
            element={
              <RequireAuth>
                <ListsIndex />
              </RequireAuth>
            }
          />
          <Route
            path="/app/settings"
            element={
              <RequireAuth>
                <RoomSettings />
              </RequireAuth>
            }
          />
          <Route
            path="/app/account"
            element={
              <RequireAuth>
                <UserSettings />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </React.Suspense>
    </main>
  )
}
