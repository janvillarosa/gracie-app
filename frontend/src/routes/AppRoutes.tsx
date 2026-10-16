import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { HouseLoader } from '@components/HouseLoader'

// Chunks to warm once the browser is idle, by who is looking: a signed-out visitor (on the
// landing page) only needs the way in, so the trip planner and its map loader never download for
// them. The landing page itself is the entry and is never prefetched.
type Audience = 'guest' | 'member' | 'entry'
const pageLoaders: Record<Audience, Array<() => Promise<unknown>>> = {
  guest: [],
  member: [],
  entry: [],
}

const lazyPage = <K extends string>(
  load: () => Promise<Record<K, React.ComponentType>>,
  name: K,
  audience: Audience = 'member',
) => {
  pageLoaders[audience].push(load)
  return React.lazy(() => load().then((m) => ({ default: m[name] })))
}

const Landing = lazyPage(() => import('@pages/Landing'), 'Landing', 'entry')
const Login = lazyPage(() => import('@pages/Login'), 'Login', 'guest')
const Register = lazyPage(() => import('@pages/Register'), 'Register', 'guest')
const Dashboard = lazyPage(() => import('@pages/Dashboard'), 'Dashboard')
const RoomSettings = lazyPage(() => import('@pages/RoomSettings'), 'RoomSettings')
const UserSettings = lazyPage(() => import('@pages/UserSettings'), 'UserSettings')
const ListPage = lazyPage(() => import('@pages/ListPage'), 'ListPage')
const ListsIndex = lazyPage(() => import('@pages/ListsIndex'), 'ListsIndex')
const TripPage = lazyPage(() => import('@pages/TripPage'), 'TripPage')
const TripSettings = lazyPage(() => import('@pages/TripSettings'), 'TripSettings')
// Dev only: the UI primitives gallery. `import.meta.env.DEV` is false in a production build, so
// this import (and the route) is dropped with it.
const DevUi = import.meta.env.DEV
  ? React.lazy(() => import('@pages/DevUi').then((m) => ({ default: m.DevUi })))
  : null

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
const prefetchPages = (audience: Audience) => () => {
  for (const load of pageLoaders[audience]) load().catch(() => {})
}

export const AppRoutes: React.FC = () => {
  const { isAuthed } = useAuth()
  React.useEffect(() => {
    const warm = prefetchPages(isAuthed ? 'member' : 'guest')
    const idle = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined
    const id = idle ? idle(warm) : window.setTimeout(warm, 1500)
    return () => {
      if (idle) (window as any).cancelIdleCallback?.(id)
      else window.clearTimeout(id)
    }
  }, [isAuthed])
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
            path="/app/trips/:tripId/settings"
            element={
              <RequireAuth>
                <TripSettings />
              </RequireAuth>
            }
          />
          <Route
            path="/app/trips/:tripId"
            element={
              <RequireAuth>
                <TripPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/trips"
            element={
              <RequireAuth>
                {/* The same element as /app: the House stays mounted across a pill switch. */}
                <Dashboard />
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
          {DevUi && <Route path="/dev/ui" element={<DevUi />} />}
          <Route
            path="/"
            element={
              <RequireGuest>
                <Landing />
              </RequireGuest>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </React.Suspense>
    </main>
  )
}
