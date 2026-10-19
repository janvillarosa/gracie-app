import { HouseMark } from '@components/HouseMark'
import { Butler } from '@components/landing/Butler'
import { Capabilities } from '@components/landing/Capabilities'
import { CloseLine, FreeReceipt, LandingFooter } from '@components/landing/Closing'
import { HeadlineWord } from '@components/landing/HeadlineWord'
import { HeroSheet } from '@components/landing/HeroSheet'
import { SharedPlate } from '@components/landing/SharedPlate'
import { StickyKey } from '@components/landing/StickyKey'
import { useScrollProgress } from '@components/landing/useScrollProgress'
import { TransitionLink } from '@components/TransitionLink'
import { useClientLayoutEffect } from '@lib/useClientLayoutEffect'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
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

const BAND: Array<[string, string, string]> = [
  ['Groceries', 'Chores', 'Trips'],
  ['Notices', 'Suggests', 'Adds'],
] as Array<[string, string, string]>

/** Two lines of huge type between the hero and Butler, set like a Bauhaus poster: what a House
 *  keeps, then what its butler does with it. They run in opposite directions as the page scrolls and
 *  stop when it stops. Decorative: the sections below say the same. */
const TypeBand: React.FC = () => {
  const band = useRef<HTMLDivElement>(null)
  useScrollProgress(band, 'through')
  return (
    <div className="ld-band" ref={band} aria-hidden="true">
      {BAND.map((words, line) => (
        <p key={words[0]} className={line === 0 ? 'ld-band-line is-a' : 'ld-band-line is-b'}>
          {[0, 1, 2].map((rep) =>
            words.map((word, w) => (
              <span key={`${rep}-${word}`}>
                {word}
                <i className={`is-${['red', 'blue', 'yellow'][(w + line) % 3]}`} />
              </span>
            )),
          )}
        </p>
      ))}
    </div>
  )
}

export const Landing: React.FC = () => {
  useDocumentTitle('Shared lists that learn your household, and trips planned together')
  useDropPrerender()
  const root = useRef<HTMLDivElement>(null)
  const lead = useRef<HTMLSpanElement>(null)
  const hero = useRef<HTMLElement>(null)
  // The sideways name drifts slower than the page as the hero scrolls away.
  useScrollProgress(hero, 'leave')
  // The page built ahead of time starts the headline's entrance before this one mounts; carrying
  // the time since navigation into the delays lets this headline pick it up where it is.
  const [since] = useState(
    () =>
      ({
        '--since': `${typeof performance === 'undefined' ? 0 : Math.round(performance.now())}ms`,
      }) as React.CSSProperties,
  )
  useReveal(root)

  return (
    <div className="ld" ref={root} id="top">
      <header className="ld-nav">
        <TransitionLink to="/" className="ld-brand" aria-label="Bauhouse home">
          <HouseMark size={34} />
          <span>Bauhouse</span>
        </TransitionLink>
        <nav aria-label="Main" className="ld-nav-links">
          <a href="#butler" className="ld-nav-link is-wide">
            Butler
          </a>
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

      <section className="ld-hero" aria-labelledby="ld-hero-h" ref={hero} style={since}>
        <span className="ld-margin-word" aria-hidden="true">
          Bauhouse
        </span>
        <div className="ld-hero-grid">
          <div className="ld-hero-copy">
            <h1 id="ld-hero-h" className="ld-h1">
              <span className="ld-lead" ref={lead}>
                Manage your
              </span>{' '}
              <span className="ld-sr">life </span>
              <HeadlineWord lead={lead} />
              <br className="ld-h1-break" /> <span className="ld-h1-end">together.</span>
            </h1>
            <p className="ld-lede">
              Bauhouse is one notebook for everyone you live with. The weekly shop goes in it, and
              so does the next trip. It comes with Butler, who learns your House’s routine and puts
              the usual things on the list before anyone has to remember them.
            </p>
            <p className="ld-hero-cta">
              <TransitionLink to="/register" className="ld-key is-large">
                Get started free
              </TransitionLink>
            </p>
          </div>
          <HeroSheet />
        </div>
      </section>

      <TypeBand />
      <Butler />
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
