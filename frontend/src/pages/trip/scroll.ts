export const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Scroll a day (or any element) to the top of the page, and move focus into it. */
export function scrollToEl(el: Element | null, focus = true) {
  if (!el) return
  ;(el as HTMLElement).scrollIntoView?.({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' })
  if (focus) {
    const target = el.querySelector<HTMLElement>('h3[tabindex], button') ?? (el as HTMLElement)
    target.focus?.({ preventScroll: true })
  }
}
