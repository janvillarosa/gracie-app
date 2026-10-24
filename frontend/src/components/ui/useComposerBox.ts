import type React from 'react'
import { useEffect, useState } from 'react'

/** The desk's composer floats over one column: it takes that column's left edge and width, 24px in
 *  from its sides. Returns the CSS variables `.desk-composer` reads, or undefined before the first
 *  measure. */
export function useComposerBox(
  column: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): React.CSSProperties | undefined {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const el = column.current
    if (!enabled || !el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ left: r.left + 24, width: Math.max(280, r.width - 48) })
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [column, enabled])
  return box
    ? ({
        '--composer-left': `${box.left}px`,
        '--composer-width': `${box.width}px`,
      } as React.CSSProperties)
    : undefined
}
