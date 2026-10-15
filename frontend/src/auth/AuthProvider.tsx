import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe } from '@api/endpoints'
import { wipeTripData } from '@lib/trips/store'

export type SignOutReason = 'user' | 'expired'

type AuthContextType = {
  apiKey: string | null
  /** `null` signs out as the user (see signOut). */
  setApiKey: (key: string | null) => void
  /** Signs out now and settles the device's trips data in the background. Resolves with how many
   *  changes could not be sent (their database is kept, not wiped); see getPendingOnLogout().
   *  'expired' (the key was refused) also goes to /login and does not try to send. `wrap` runs the
   *  state change, e.g. inside a view transition. */
  signOut: (reason?: SignOutReason, wrap?: (commit: () => void) => void) => Promise<number>
  isAuthed: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = 'gracie_api_key'

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [apiKey, setApiKeyState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const navigate = useNavigate()

  const signingOut = useRef<Promise<number> | null>(null)

  const signOut = useCallback(
    (reason: SignOutReason = 'user', wrap?: (commit: () => void) => void) => {
      if (signingOut.current) return signingOut.current
      const commit = () => {
        localStorage.removeItem(STORAGE_KEY)
        setApiKeyState(null)
        if (reason === 'expired') navigate('/login', { replace: true })
      }
      // The person is signed out at once. Meanwhile the stores send what is queued (still with
      // the key they hold; not when it is already refused) and then this user's trips data is
      // taken off the device, unless some changes could not be sent: those stay for next time.
      if (wrap) wrap(commit)
      else commit()
      const p = wipeTripData({ flush: reason === 'user' })
        .catch(() => 0)
        .finally(() => {
          signingOut.current = null
        })
      signingOut.current = p
      return p
    },
    [navigate],
  )

  const setApiKey = useCallback(
    (key: string | null) => {
      if (key) {
        setApiKeyState(key)
        localStorage.setItem(STORAGE_KEY, key)
      } else void signOut('user')
    },
    [signOut],
  )

  // Optional: verify key on mount
  useEffect(() => {
    const verify = async () => {
      if (!apiKey) return
      try {
        await getMe(apiKey)
      } catch (e) {
        // Only a refused key ends the session. Offline, a timeout or a 5xx says nothing about the
        // key, and signing out here would wipe the device's unsynced trips.
        if ((e as { status?: number } | null)?.status !== 401) return
        void signOut('expired')
      }
    }
    void verify()
  }, [apiKey, signOut])

  const value = useMemo(
    () => ({ apiKey, setApiKey, signOut, isAuthed: !!apiKey }),
    [apiKey, setApiKey, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
