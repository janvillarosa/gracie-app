import { confettiAt } from '@lib/confetti'

// The app bursts confetti when you check something off; the landing page does the same, in the
// brand's own colours, from the checkbox that was ticked.
const BRAND = ['#FFD417', '#2348A6', '#BE1E2D', '#1A1A1A', '#FFFFFF']

export function confettiFrom(el: Element | null | undefined) {
  if (!el) return
  const r = el.getBoundingClientRect()
  confettiAt(r.left + r.width / 2, r.top + r.height / 2, {
    colors: BRAND,
    count: 26,
    durationMs: 1400,
  })
}
