export function confettiAt(x: number, y: number, opts?: { colors?: string[]; count?: number; durationMs?: number }) {
  if (typeof document === 'undefined') return
  const colors = opts?.colors || ['#A094F2', '#7D6EF0', '#F3F78A', '#C7B090', '#FF7A90', '#74E0A6']
  const count = opts?.count ?? 40 // denser burst
  const duration = opts?.durationMs ?? 2000
  const gravity = 1600 // px/s^2, stronger gravity for visible arcs
  const drag = 0.98 // air resistance factor per frame

  const root = document.createElement('div')
  root.className = 'confetti-root'
  document.body.appendChild(root)

  type Part = { el: HTMLDivElement; x: number; y: number; vx: number; vy: number; rot: number; vrot: number; life: number }
  const parts: Part[] = []

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'confetti-piece'
    el.style.left = '0px'
    el.style.top = '0px'
    el.style.backgroundColor = colors[i % colors.length]
    // vary sizes slightly
    const w = 4 + Math.round(Math.random() * 5)
    const h = 8 + Math.round(Math.random() * 7)
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    root.appendChild(el)

    // Fast initial velocity with upward bias
    const angle = Math.random() * Math.PI * 2
    const speed = 200 + Math.random() * 400 // faster burst speed
    const vx = Math.cos(angle) * speed
    // Ensure mostly upward start so arcs are visible
    const vy = -Math.abs(Math.sin(angle)) * speed
    const vrot = (Math.random() * 8 - 4) * 180 // deg/s
    parts.push({ el, x, y, vx, vy, rot: 0, vrot, life: 0 })
  }

  const start = performance.now()
  let last = start
  let raf = 0
  const tick = (now: number) => {
    const elapsedMs = now - start
    let dt = (now - last) / 1000
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60
    if (dt > 1 / 20) dt = 1 / 20 // cap large frame gaps for stability
    last = now
    for (const p of parts) {
      if (elapsedMs > duration) continue
      // simple integration
      p.vx *= drag
      p.vy = p.vy * drag + gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vrot * dt
      p.life = elapsedMs / 1000
      const alpha = Math.max(0, 1 - elapsedMs / duration)
      p.el.style.opacity = String(alpha)
      p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot.toFixed(1)}deg)`
    }
    if (elapsedMs < duration) {
      raf = requestAnimationFrame(tick)
    } else {
      try { document.body.removeChild(root) } catch {}
    }
  }
  raf = requestAnimationFrame(tick)
}
