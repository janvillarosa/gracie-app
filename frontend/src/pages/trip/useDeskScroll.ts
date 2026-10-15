import { useEffect } from 'react'

const key = (tripId: string) => `bauhouse_trips_scroll_${tripId}`

type Saved = { days?: number; ideas?: number }

const read = (tripId: string): Saved => {
  try {
    return JSON.parse(sessionStorage.getItem(key(tripId)) ?? '{}') as Saved
  } catch {
    return {}
  }
}
const write = (tripId: string, v: Saved) => {
  try {
    sessionStorage.setItem(key(tripId), JSON.stringify(v))
  } catch {}
}

/** The desk's panes: the Days container and the Ideas list. */
export const panes = () => ({
  days: document.querySelector<HTMLElement>('.trip-days-col'),
  ideas: document.querySelector<HTMLElement>('.trip-ideas-col .trip-ideas'),
})

/** The desk keeps each pane's scroll position for the trip (per tab): leaving for Trip settings and
 *  coming back lands where you were. A `?day=` link wins over the Days position. */
export function useDeskScroll(
  tripId: string,
  enabled: boolean,
  ready: boolean,
  hasDayLink: boolean,
) {
  // Restore once the plan has rendered.
  useEffect(() => {
    if (!enabled || !ready) return
    const saved = read(tripId)
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const p = panes()
        if (p.days && saved.days && !hasDayLink) p.days.scrollTop = saved.days
        if (p.ideas && saved.ideas) p.ideas.scrollTop = saved.ideas
      }),
    )
    return () => cancelAnimationFrame(id)
  }, [tripId, enabled, ready, hasDayLink])

  // Save as the panes scroll (a little after the last scroll), and when leaving.
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const save = () => {
      const p = panes()
      write(tripId, {
        days: p.days?.scrollTop ?? 0,
        ideas: p.ideas?.scrollTop ?? 0,
      })
    }
    const onScroll = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 120)
    }
    // Scroll does not bubble: listen in the capture phase on the document.
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      if (timer) clearTimeout(timer)
      save()
    }
  }, [tripId, enabled])
}
