import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './ui.css'

/** What the bar spreads onto its text field. Focus never leaves the field: options are not tab
 *  stops, the highlighted one is announced through aria-activedescendant. */
export type ComboboxInputProps = {
  role: 'combobox'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  'aria-autocomplete': 'list' | 'both'
  'aria-activedescendant': string | undefined
  onKeyDown: (e: React.KeyboardEvent) => void
  onBlur: () => void
}

export type ComboboxRender = {
  input: ComboboxInputProps
  // The completion tail to draw after the typed text; empty unless the top option is the target.
  ghost: string
}

type Props<T> = {
  // The suggestions, best first. Empty means closed.
  options: T[]
  getKey: (o: T) => string
  // Accessible name of an option ("Basmati rice, 1 kg").
  getLabel: (o: T) => string
  // The inside of one slip; the combobox owns the option element around it.
  renderOption: (o: T) => React.ReactNode
  onPick: (o: T) => void
  // Enter with nothing highlighted: the bar adds exactly what was typed.
  onSubmitText: () => void
  // The text field's draft. When it changes, the highlight and a dismissal reset.
  query: string
  // The tail of the top option past what is typed. Tab takes it.
  ghost?: string
  onAcceptGhost?: () => void
  // Runs before the combobox keys; return true to say the key is handled.
  onKeyDown?: (e: React.KeyboardEvent) => boolean | undefined
  // The highlighted option, or null (also on unmount), e.g. to preview it on a map.
  onHighlight?: (o: T | null) => void
  // Non-option content inside the listbox (an attribution line).
  footer?: React.ReactNode
  listLabel?: string
  // 'above' (an add bar: slips rise, best nearest the field) or 'below' (an inline field).
  placement?: 'above' | 'below'
  autoComplete?: 'list' | 'both'
  children: (r: ComboboxRender) => React.ReactNode
}

// While the keyboard is up, keep the slips inside what is visible: lift them by however much of
// the bar the keyboard hides, and cap their height to the room above the bar.
function useVisualViewportFit(open: boolean, listRef: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport
    const list = listRef.current
    const bar = list?.offsetParent as HTMLElement | null
    if (!open || !vv || !list || !bar) return
    let raf = 0
    const fit = () => {
      raf = 0
      const r = bar.getBoundingClientRect()
      const hidden = Math.max(0, Math.round(r.bottom - (vv.offsetTop + vv.height)))
      const room = Math.max(88, Math.round(r.top - hidden - vv.offsetTop - 12))
      list.style.bottom = `calc(100% + 6px + ${hidden}px)`
      list.style.maxHeight = `${room}px`
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(fit)
    }
    fit()
    vv.addEventListener('resize', queue)
    vv.addEventListener('scroll', queue)
    return () => {
      vv.removeEventListener('resize', queue)
      vv.removeEventListener('scroll', queue)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [open, listRef])
}

/**
 * The ARIA combobox shared by the list add bar (pantry) and the trip add bar (places): a
 * listbox of "slips" that rises above the bar, up/down to highlight, Esc to close, Tab to take
 * the ghost text, a polite count. Enter is never hijacked: it picks only an option the user
 * explicitly highlighted, otherwise it submits the typed text.
 *
 * The draft text stays in the bar (keystrokes must not re-render the page); the combobox keeps
 * only the highlight and the dismissed flag.
 */
export function Combobox<T>({
  options,
  getKey,
  getLabel,
  renderOption,
  onPick,
  onSubmitText,
  query,
  ghost = '',
  onAcceptGhost,
  onKeyDown,
  onHighlight,
  footer,
  listLabel = 'Suggestions',
  placement = 'above',
  autoComplete = 'list',
  children,
}: Props<T>) {
  const uid = useId()
  const listId = `${uid}-slips`
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [seen, setSeen] = useState(query)
  const listRef = useRef<HTMLDivElement>(null)

  // Typing starts over: no highlight, and a closed list may open again.
  if (seen !== query) {
    setSeen(query)
    setActive(-1)
    setDismissed(false)
  }

  const open = options.length > 0 && !dismissed
  const current = open && active >= 0 ? (options[active] ?? null) : null
  const effectiveGhost = open && active < 0 ? ghost : ''

  useVisualViewportFit(open && placement === 'above', listRef)

  // (The callback is read through a ref, so a new function each render cannot loop.)
  const highlightRef = useRef(onHighlight)
  highlightRef.current = onHighlight
  useEffect(() => {
    highlightRef.current?.(current)
    return () => highlightRef.current?.(null)
  }, [current])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
      if (onKeyDown?.(e)) return
      // The slips rise above a bar (best nearest the field), so up is "next"; below, down is.
      const nextKey = placement === 'above' ? 'ArrowUp' : 'ArrowDown'
      const prevKey = placement === 'above' ? 'ArrowDown' : 'ArrowUp'
      if (open && e.key === nextKey) {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, options.length - 1))
      } else if (open && e.key === prevKey) {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, -1))
      } else if (open && e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        setActive(-1)
      } else if (e.key === 'Tab' && effectiveGhost && !e.shiftKey && onAcceptGhost) {
        e.preventDefault()
        onAcceptGhost()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        // Enter only takes an option the user explicitly moved to.
        if (current) onPick(current)
        else onSubmitText()
      }
    },
    [
      onKeyDown,
      placement,
      open,
      options.length,
      effectiveGhost,
      onAcceptGhost,
      current,
      onPick,
      onSubmitText,
    ],
  )

  const input: ComboboxInputProps = {
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-autocomplete': autoComplete,
    'aria-activedescendant': open && active >= 0 ? `${uid}-slip-${active}` : undefined,
    onKeyDown: handleKeyDown,
    onBlur: () => setActive(-1),
  }

  return (
    <>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className={placement === 'below' ? 'pantry-slips is-below' : 'pantry-slips'}
        >
          {options.map((o, i) => (
            // Options aren't focusable by design: focus stays in the field.
            // biome-ignore lint/a11y/useFocusableInteractive: combobox options are not tab stops
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard goes through the combobox field
            <div
              key={getKey(o)}
              id={`${uid}-slip-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={getLabel(o)}
              className={i === active ? 'pantry-slip is-active' : 'pantry-slip'}
              // Keep focus in the field so the keyboard stays up for the next add.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(o)}
            >
              {renderOption(o)}
            </div>
          ))}
          {footer}
        </div>
      )}
      <span className="ui-combobox-count sr-only" role="status" aria-live="polite">
        {open ? `${options.length} suggestion${options.length === 1 ? '' : 's'}` : ''}
      </span>
      {children({ input, ghost: effectiveGhost })}
    </>
  )
}
