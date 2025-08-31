import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe } from '@api/endpoints'

type AuthContextType = {
  apiKey: string | null
  setApiKey: (key: string | null) => void
  isAuthed: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = 'gracie_api_key'

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [apiKey, setApiKeyState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const navigate = useNavigate()

  const setApiKey = useCallback((key: string | null) => {
    setApiKeyState(key)
    if (key) localStorage.setItem(STORAGE_KEY, key)
    else localStorage.removeItem(STORAGE_KEY)
  }, [])

  // Optional: verify key on mount
  useEffect(() => {
    const verify = async () => {
      if (!apiKey) return
      try {
        await getMe(apiKey)
      } catch (e) {
        // invalid key
        setApiKey(null)
        navigate('/login', { replace: true })
      }
    }
    void verify()
  }, [apiKey, navigate, setApiKey])

  const value = useMemo(() => ({ apiKey, setApiKey, isAuthed: !!apiKey }), [apiKey, setApiKey])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

