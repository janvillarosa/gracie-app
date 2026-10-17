import React from 'react'
import './ui.css'

type Step<T extends string> = { value: T; label: string; icon: React.ReactNode }

type Props<T extends string> = {
  // Names the control for screen readers ("Autopilot").
  label: string
  value: T
  // Low to high: how much is handed over grows to the right.
  steps: Array<Step<T>>
  onChange: (v: T) => void
  // The line that explains the chosen step (aria-describedby).
  describedBy?: string
  disabled?: boolean
}

/** A few stops on one scale, chosen by sliding a paper key along a groove pressed into the sheet.
 *  The groove fills with key yellow up to the key, the key carries the chosen stop's glyph, and the
 *  glyph turns a quarter as it lands. Drag it, tap a stop's name, or use the arrow keys. For a
 *  setting that is a matter of degree (autopilot: Off · Suggest · Assist); a plain choice is a
 *  ChipGroup. */
export function StepSlider<T extends string>({
  label,
  value,
  steps,
  onChange,
  describedBy,
  disabled,
}: Props<T>) {
  const at = Math.max(
    0,
    steps.findIndex((s) => s.value === value),
  )
  const last = steps.length - 1
  const railRef = React.useRef<HTMLDivElement>(null)
  // While dragging: where the key is (0..1) and which stop it is nearest; null at rest.
  const [drag, setDrag] = React.useState<{ pos: number; near: number } | null>(null)

  const choose = (i: number) => {
    const next = steps[Math.min(last, Math.max(0, i))]
    if (next && next.value !== value) onChange(next.value)
  }
  const posAt = (clientX: number) => {
    const rail = railRef.current?.getBoundingClientRect()
    if (!rail || rail.width === 0) return at / last
    return Math.min(1, Math.max(0, (clientX - rail.left) / rail.width))
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.button ?? 0) > 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const pos = posAt(e.clientX)
    setDrag({ pos, near: Math.round(pos * last) })
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const pos = posAt(e.clientX)
    const near = Math.round(pos * last)
    // A small tick each time the key passes a stop, where the device can.
    if (near !== drag.near) navigator.vibrate?.(6)
    setDrag({ pos, near })
  }
  const endDrag = () => {
    if (!drag) return
    choose(drag.near)
    setDrag(null)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowUp: at + 1,
      ArrowLeft: at - 1,
      ArrowDown: at - 1,
      Home: 0,
      End: last,
    }
    if (!(e.key in step)) return
    e.preventDefault()
    choose(step[e.key])
  }

  const shown = drag ? drag.near : at
  const pos = drag ? drag.pos : at / last
  return (
    <div
      className={drag ? 'ui-steps is-dragging' : 'ui-steps'}
      style={{ '--pos': pos, '--steps': steps.length } as React.CSSProperties}
    >
      <div
        className="ui-steps-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={at}
        aria-valuetext={steps[at]?.label}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        <span className="ui-steps-groove" aria-hidden>
          <span className="ui-steps-carriage">
            <span className="ui-steps-fill" />
          </span>
          {steps.map((s, i) => (
            <span
              key={s.value}
              className="ui-steps-stop"
              data-reached={i <= shown || undefined}
              style={{ '--i': i } as React.CSSProperties}
            />
          ))}
        </span>
        <span className="ui-steps-rail" ref={railRef} aria-hidden>
          <span className="ui-steps-carriage">
            <span className="ui-steps-key" data-step={shown}>
              {steps.map((s, i) => (
                <span key={s.value} className="ui-steps-glyph" data-on={i === shown || undefined}>
                  {s.icon}
                </span>
              ))}
            </span>
          </span>
        </span>
      </div>
      {/* The names are the slider's stops, so they are not a second control for screen readers;
          a tap on one moves the key there. */}
      <div className="ui-steps-names" aria-hidden>
        {steps.map((s, i) => (
          <button
            key={s.value}
            type="button"
            tabIndex={-1}
            className="ui-steps-name"
            data-on={i === shown || undefined}
            disabled={disabled}
            onClick={() => choose(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
