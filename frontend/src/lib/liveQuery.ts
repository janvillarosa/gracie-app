import { useMemo } from 'react'
import { usePageVisible } from './usePageVisible'

function jitter(ms: number, pct: number = 0.2) {
  const delta = ms * pct
  const min = ms - delta
  const max = ms + delta
  return Math.round(min + Math.random() * (max - min))
}

// Hook that returns standard live query options for React Query
export function useLiveQueryOpts(baseMs: number) {
  const visible = usePageVisible()

  return useMemo(() => ({
    // In v5, refetchInterval can be a function receiving the query instance
    refetchInterval: (query: any) => {
      if (!visible) return false
      const failures: number = query?.state?.fetchFailureCount ?? 0
      const factor = Math.max(1, failures)
      return jitter(baseMs) * factor
    },
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: true,
    // Small stale time so components re-render with fresh data frequently
    staleTime: 1000,
  }), [visible, baseMs])
}

