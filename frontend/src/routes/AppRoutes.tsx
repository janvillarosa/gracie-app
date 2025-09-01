import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { Login } from '@pages/Login'
import { Register } from '@pages/Register'
import { Dashboard } from '@pages/Dashboard'
import { RoomSettings } from '@pages/RoomSettings'

const RequireAuth: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { isAuthed } = useAuth()
  const loc = useLocation()
  if (!isAuthed) {
    return <Navigate to="/login" state={{ from: loc }} replace />
  }
  return <>{children}</>
}

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
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
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}
