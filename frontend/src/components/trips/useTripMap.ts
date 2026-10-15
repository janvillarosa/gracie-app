import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

const OFFLINE_HIDE_MS = 5000

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const onlineNow = () => navigator.onLine !== false

/** The browser's online flag, re-rendering when it changes. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineNow, () => true)
}

/** Whether the map may show: yes while online; going offline hides it only after a few
 *  seconds, so a flaky connection does not flicker it; coming back shows it at once. */
export function useMapOk(online: boolean): boolean {
  const [ok, setOk] = useState(online)
  useEffect(() => {
    if (online) {
      setOk(true)
      return
    }
    const t = setTimeout(() => setOk(false), OFFLINE_HIDE_MS)
    return () => clearTimeout(t)
  }, [online])
  return ok
}

/** Whether scene changes may refit the map: it pauses when the person zooms or pans, and waits
 *  for "Fit day", "Show" on the off-the-map chip, or a day picked from the list. */
export function useMapFollow() {
  const [following, setFollowing] = useState(true)
  const [fitToken, setFitToken] = useState(0)
  const pause = useCallback(() => setFollowing(false), [])
  const resume = useCallback(() => setFollowing(true), [])
  const fit = useCallback(() => {
    setFollowing(true)
    setFitToken((n) => n + 1)
  }, [])
  return { following, fitToken, pause, resume, fit }
}
