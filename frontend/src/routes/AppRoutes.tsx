import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'

const lazyPage = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })))

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

export const AppRoutes: React.FC = () => {
  return (
    <React.Suspense fallback={<div className="container" aria-busy="true" />}>
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
  )
}
