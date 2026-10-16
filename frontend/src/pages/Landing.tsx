import { HouseMark } from '@components/HouseMark'
import { Capabilities } from '@components/landing/Capabilities'
import { CloseLine, FreeReceipt, LandingFooter } from '@components/landing/Closing'
import { HeadlineWord } from '@components/landing/HeadlineWord'
import { HeroSheet } from '@components/landing/HeroSheet'
import { SharedPlate } from '@components/landing/SharedPlate'
import { StickyKey } from '@components/landing/StickyKey'
import { TransitionLink } from '@components/TransitionLink'
import { useClientLayoutEffect } from '@lib/useClientLayoutEffect'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import type React from 'react'
import { useEffect, useRef } from 'react'
import '@components/landing/devices.css'
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

// The build-time copy of this page (scripts/prerender.mjs) shows until this one is on screen;
// removing it before paint swaps one for the other without a flash.
function useDropPrerender() {
  useClientLayoutEffect(() => {
    document.getElementById('prerender')?.remove()
  }, [])
}

export const Landing: React.FC = () => {
  useDocumentTitle('Shared lists and trip planning for your household')
  useDropPrerender()
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
            Get started
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
          Bauhouse is where your household keeps the weekly shop and the next trip. Everyone you
          live with joins your House and works from the same plan, so nobody has to scroll the group
          chat looking for that one screenshot.
        </p>
        <p className="ld-hero-cta">
          <TransitionLink to="/register" className="ld-key is-large">
            Get started free
          </TransitionLink>
        </p>
        <HeroSheet />
      </section>

      <SharedPlate />
      <Capabilities />
      <FreeReceipt />
      <CloseLine />
      <LandingFooter />
      <StickyKey
        away=".ld-hero-cta"
        avoid=".ld-nav .ld-key, .ld-free .ld-key, .ld-close, .ld-footer"
        spare="[data-ui], .ld-capsheet-name"
      />
    </div>
  )
}
