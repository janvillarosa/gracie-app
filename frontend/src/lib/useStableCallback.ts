import { useCallback, useRef } from 'react'

// Returns a function with a permanent identity that always calls the latest `fn`.
// Lets memoized children receive handlers that close over fresh state without re-rendering.
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
