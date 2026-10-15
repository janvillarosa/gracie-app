import { useEffect, useState } from 'react'

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const fn = () => setOn(mq.matches)
    fn()
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [query])
  return on
}
