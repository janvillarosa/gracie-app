import { HouseMark } from '@components/HouseMark'
import { Capabilities } from '@components/landing/Capabilities'
import { CloseLine, FreeReceipt, LandingFooter } from '@components/landing/Closing'
import { HeadlineWord } from '@components/landing/HeadlineWord'
import { HeroSheet } from '@components/landing/HeroSheet'
import { OfflineSlip } from '@components/landing/OfflineSlip'
import { Parts } from '@components/landing/Parts'
import { SharedPlate } from '@components/landing/SharedPlate'
import { StickyKey } from '@components/landing/StickyKey'
import { TransitionLink } from '@components/TransitionLink'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import type React from 'react'
import { useEffect, useRef } from 'react'
import '@components/landing/landing.css'

// Entrances: parts marked data-reveal rise into place once, as their section arrives. Content is
// visible by default; only a browser with IntersectionObserver and no reduced-motion preference
// opts into the hidden starting state, so nothing stays hidden if this never runs.
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // A data attribute, not a class: React rewrites className when a part's state
            // changes (the slip going offline), which would hide it again.
            const part = e.target as HTMLElement
            part.dataset.in = ''
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    el.classList.add('ld-motion')
    for (const t of el.querySelectorAll('[data-reveal]')) io.observe(t)
    return () => io.disconnect()
  }, [root])
}

export const Landing: React.FC = () => {
  useDocumentTitle('Manage your life together')
  const root = useRef<HTMLDivElement>(null)
  const lead = useRef<HTMLSpanElement>(null)
  useReveal(root)

  return (
    <div className="ld" ref={root} id="top">
      <header className="ld-nav">
        <TransitionLink to="/" className="ld-brand" aria-label="Bauhouse home">
          <HouseMark size={34} />
          <span>Bauhouse</span>
        </TransitionLink>
        <nav aria-label="Main" className="ld-nav-links">
          <a href="#lists" className="ld-nav-link is-wide">
            Lists
          </a>
          <a href="#trips" className="ld-nav-link is-wide">
            Trips
          </a>
          <TransitionLink to="/login" className="ld-nav-link">
            Log in
          </TransitionLink>
          <TransitionLink to="/register" className="ld-key">
            Try it free
          </TransitionLink>
        </nav>
      </header>

      <section className="ld-hero" aria-labelledby="ld-hero-h">
        <h1 id="ld-hero-h" className="ld-h1">
          <span className="ld-lead" ref={lead}>
            Manage your
          </span>{' '}
          <span className="ld-sr">life </span>
          <HeadlineWord lead={lead} />
          <br className="ld-h1-break" /> together.
        </h1>
        <p className="ld-lede">
          Bauhouse is one simple app for the lists you keep at home and the trips you plan away.
          There’s no Notion template to build and no Google Sheet or Doc to share around, so you
          have more time for everything else.
        </p>
        <p className="ld-hero-cta">
          <TransitionLink to="/register" className="ld-key is-large">
            Try Bauhouse free
          </TransitionLink>
        </p>
        <HeroSheet />
      </section>

      <Parts />
      <SharedPlate />
      <Capabilities />
      <OfflineSlip />
      <FreeReceipt />
      <CloseLine />
      <LandingFooter />
      <StickyKey away=".ld-hero-cta" until=".ld-close, .ld-footer" />
    </div>
  )
}
