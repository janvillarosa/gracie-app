import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

export type PillItem = {
  key: string
  label: React.ReactNode
  // Announced instead of the label's text (for example when a dot carries meaning).
  ariaLabel?: string
  children: React.ReactNode
}

type Props = {
  items: PillItem[]
  value: string
  onChange: (key: string) => void
  // The sheet's yellow key (or another control), shown at the right of the same row.
  extra?: React.ReactNode
  label?: string
}

/** The one pill segmented control: House (Lists · Trips), List (Items · Notes) and Trip
 *  (Plan · Ideas · Bookings). A tablist with arrow keys, a sliding pill, and the active pane
 *  settling in. Panes are transform/opacity only, and swap at once with reduced motion. */
export const PillNav: React.FC<Props> = ({ items, value, onChange, extra, label }) => {
  const uid = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const [vars, setVars] = useState<React.CSSProperties>({})
  const active = items.find((i) => i.key === value) ?? items[0]
  const activeIndex = Math.max(
    0,
    items.findIndex((x) => x.key === active.key),
  )
  const activeRef = useRef(activeIndex)
  activeRef.current = activeIndex

  // Slide the pill under the active tab. The observer is set up once (callers pass a fresh
  // items array every render); a change of tab just measures again.
  const measure = useCallback(() => {
    const el = tabs.current[activeRef.current]
    if (!el) return
    const left = `${el.offsetLeft}px`
    const width = `${el.offsetWidth}px`
    setVars((p) =>
      (p as Record<string, string>)['--tab-x'] === left &&
      (p as Record<string, string>)['--tab-w'] === width
        ? p
        : ({ '--tab-x': left, '--tab-w': width } as React.CSSProperties),
    )
  }, [])
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [measure])
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when the tab changes
  useEffect(() => {
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [measure, active.key])

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    let n: number | null = null
    if (e.key === 'ArrowRight') n = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = items.length - 1
    if (n === null) return
    e.preventDefault()
    onChange(items[n].key)
    tabs.current[n]?.focus()
  }

  return (
    <div className="pill-nav" style={vars}>
      <div className="pill-nav-bar">
        <div ref={listRef} className="pill-nav-list" role="tablist" aria-label={label}>
          {items.map((it, i) => (
            <button
              key={it.key}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${it.key}`}
              aria-selected={it.key === active.key}
              // Only the open tab has a panel in the page to point at.
              aria-controls={it.key === active.key ? `${uid}-panel-${it.key}` : undefined}
              aria-label={it.ariaLabel}
              tabIndex={it.key === active.key ? 0 : -1}
              className="pill-nav-tab"
              onClick={() => onChange(it.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {it.label}
            </button>
          ))}
        </div>
        {extra && <div className="pill-nav-extra">{extra}</div>}
      </div>
      <div
        key={active.key}
        role="tabpanel"
        id={`${uid}-panel-${active.key}`}
        aria-labelledby={`${uid}-tab-${active.key}`}
        className="pill-nav-pane"
      >
        {active.children}
      </div>
    </div>
  )
}
