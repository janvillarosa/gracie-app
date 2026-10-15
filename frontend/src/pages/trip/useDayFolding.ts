import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, longDay, type DayModel } from '@lib/trips/schedule'
import { reduced } from './scroll'

const CELEBRATE_MS = 1100

type Args = {
  days: DayModel[]
  doneDays: ReadonlySet<string>
  phone: boolean
  phase: string
  today: string
  announce: (t: string) => void
  // Opening or closing a day by hand resumes the map's follow-the-day.
  onToggle: () => void
}

/** Which days are open cards and which are closed: today and tomorrow (or the first two plan
 *  days) open on phones, everything open on wide screens, plus what the person toggled. A day
 *  that finishes shows "Day done" for a moment and then folds into a slim line; unticking
 *  anything unfolds it again. */
export function useDayFolding({ days, doneDays, phone, phase, today, announce, onToggle }: Args) {
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(() => new Set())

  const planDates = days.filter((d) => !doneDays.has(d.date)).map((d) => d.date)
  const firstPlanDate = planDates[0]
  const secondPlanDate = planDates[1]
  const isOpenDay = useCallback(
    (d: DayModel) =>
      celebrating.has(d.date) ||
      (override[d.date] ??
        (!phone ||
          (phase === 'during'
            ? d.date <= addDays(today, 1)
            : d.date === firstPlanDate || d.date === secondPlanDate))),
    [celebrating, override, phone, phase, today, firstPlanDate, secondPlanDate],
  )

  const prevDone = useRef<ReadonlySet<string> | null>(null)
  const foldTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const doneKey = [...doneDays].sort().join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: doneKey stands for doneDays' contents
  useEffect(() => {
    const prev = prevDone.current
    prevDone.current = doneDays
    if (!prev) return
    for (const date of doneDays) {
      if (prev.has(date)) continue
      const fold = () => {
        foldTimers.current.delete(date)
        setCelebrating((c) => {
          const n = new Set(c)
          n.delete(date)
          return n
        })
        setOverride((o) => {
          const { [date]: _x, ...rest } = o
          return rest
        })
        announce(`${longDay(date)} done, folded`)
      }
      if (reduced()) fold()
      else {
        setCelebrating((c) => new Set(c).add(date))
        foldTimers.current.set(date, setTimeout(fold, CELEBRATE_MS))
      }
    }
    for (const date of prev) {
      if (doneDays.has(date)) continue
      const t = foldTimers.current.get(date)
      if (t) clearTimeout(t)
      foldTimers.current.delete(date)
      setCelebrating((c) => {
        if (!c.has(date)) return c
        const n = new Set(c)
        n.delete(date)
        return n
      })
      setOverride((o) => {
        if (!(date in o)) return o
        const { [date]: _x, ...rest } = o
        return rest
      })
    }
  }, [doneKey])
  useEffect(() => {
    const timers = foldTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [])

  const toggleDay = useCallback(
    (date: string) => {
      const d = days.find((x) => x.date === date)
      if (!d) return
      setOverride((o) => ({ ...o, [date]: !isOpenDay(d) }))
      onToggle()
    },
    [days, isOpenDay, onToggle],
  )
  const openDay = useCallback((date: string) => setOverride((o) => ({ ...o, [date]: true })), [])
  // A new item added to a day shows that day.
  const showDay = useCallback(
    (date: string) => setOverride((o) => (o[date] === true ? o : { ...o, [date]: true })),
    [],
  )

  return { override, celebrating, isOpenDay, toggleDay, openDay, showDay }
}
