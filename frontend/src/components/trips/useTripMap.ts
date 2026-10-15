import { useCallback, useEffect, useState } from 'react'

const OFFLINE_HIDE_MS = 5000

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

/** The map follows the day being read until the person zooms or pans it; then it waits for
 *  "Fit day", a day picked from the list, or a day opened. */
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
