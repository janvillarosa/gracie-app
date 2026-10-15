import { useEffect, useRef, useState } from 'react'
import type React from 'react'

/** The list page's sliding pill under the active tab: measures the active tab and exposes
 *  --tab-x / --tab-w for the .list-tabs styles. */
export function usePillTabs(active: string) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [vars, setVars] = useState<React.CSSProperties>({})
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const list = wrap.querySelector('.ant-tabs-nav .ant-tabs-nav-list') as HTMLElement | null
    if (!list) return
    const update = () => {
      const tab = wrap.querySelector('.ant-tabs-nav .ant-tabs-tab-active') as HTMLElement | null
      if (!tab) return
      const lr = list.getBoundingClientRect()
      const ar = tab.getBoundingClientRect()
      const left = `${Math.max(0, ar.left - lr.left)}px`
      const width = `${Math.max(0, ar.width)}px`
      setVars((prev) =>
        (prev as Record<string, string>)['--tab-x'] === left &&
        (prev as Record<string, string>)['--tab-w'] === width
          ? prev
          : ({ '--tab-x': left, '--tab-w': width } as React.CSSProperties),
      )
    }
    const id = requestAnimationFrame(update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(list)
    return () => {
      cancelAnimationFrame(id)
      ro?.disconnect()
    }
  }, [active])
  return { wrapRef, vars }
}
