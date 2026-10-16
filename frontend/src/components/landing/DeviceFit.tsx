import type React from 'react'
import { useEffect, useRef, useState } from 'react'

/** Shows a device frame (laid out at its own fixed size) scaled to the width it has, up to `max`,
 *  so a phone shows the same laptop, smaller. A transform doesn't change the space a box takes,
 *  so the height is set to match. Without JavaScript the device shows at its own size. */
export const DeviceFit: React.FC<React.PropsWithChildren<{ max?: number; className?: string }>> = ({
  max = 1,
  className,
  children,
}) => {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, height: 0 })

  useEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      if (!i.offsetWidth) return
      const scale = Math.min(max, o.clientWidth / i.offsetWidth)
      const height = Math.ceil(i.offsetHeight * scale)
      setFit((f) => (f.scale === scale && f.height === height ? f : { scale, height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [max])

  return (
    <div
      ref={outer}
      className={['ld-fit', fit.height ? 'is-fitted' : '', className].filter(Boolean).join(' ')}
      style={fit.height ? { height: fit.height } : undefined}
    >
      <div
        ref={inner}
        className="ld-fit-inner"
        style={fit.height ? { transform: `translateX(-50%) scale(${fit.scale})` } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
