import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

type Toast = { id: number; message: string }

type ToastContextType = {
  show: (message: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, durationMs = 3000) => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts, { id, message }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), durationMs)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

