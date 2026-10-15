import { TransitionLink } from '@components/TransitionLink'
import { PENDING_HOUSE_KEY } from '@lib/pendingHouse'
import { useTransitionNavigate } from '@lib/viewTransition'
import React, { useState } from 'react'

const RECEIPT_LINES: Array<[string, string]> = [
  ['Lists', '0.00'],
  ['Trips, with maps and bookings', '0.00'],
  ['Everyone at home', '0.00'],
  ['Works with no signal', '0.00'],
]

/** The price, rung up on a shop receipt: everything in the House comes to 0.00, and a "Nothing
 *  due" stamp lands on it as it scrolls into view. */
export const FreeReceipt: React.FC = () => (
  <section className="ld-free" aria-labelledby="ld-free-h">
    <div className="ld-free-copy">
      <h2 id="ld-free-h" className="ld-h2" data-reveal>
        It costs nothing.
      </h2>
      <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
        There’s no plan to pick and no card to enter. Add everyone at home, make as many lists and
        trips as you like, and keep using it for as long as you do.
      </p>
      <TransitionLink
        to="/register"
        className="ld-key is-large"
        data-reveal
        style={{ '--i': 2 } as React.CSSProperties}
      >
        Try Bauhouse free
      </TransitionLink>
    </div>
    <div className="ld-receipt-wrap" data-reveal>
      <div
        className="ld-receipt"
        role="img"
        aria-label="A receipt for a House on Bauhouse: lists, trips, housemates and offline use all come to 0.00. Total 0.00, nothing due."
      >
        <p className="ld-receipt-head">Bauhouse</p>
        <p className="ld-receipt-sub">Your House</p>
        <ul className="ld-receipt-lines" aria-hidden="true">
          {RECEIPT_LINES.map(([what, price]) => (
            <li key={what}>
              <span>{what}</span>
              <span className="ld-leader" />
              <span className="ld-receipt-price">{price}</span>
            </li>
          ))}
        </ul>
        <p className="ld-receipt-total" aria-hidden="true">
          <span>Total</span>
          <span className="ld-receipt-price">0.00</span>
        </p>
        <p className="ld-receipt-foot" aria-hidden="true">
          No card needed. Thanks for shopping.
        </p>
        <span className="ld-receipt-stamp" aria-hidden="true">
          Nothing due
        </span>
      </div>
    </div>
  </section>
)

/** The closing sentence; its blank is the House name and its last word is the button. The name
 *  waits in this tab until the new member creates their House. */
export const CloseLine: React.FC = () => {
  const [name, setName] = useState('')
  const go = useTransitionNavigate()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const house = name.trim()
    try {
      if (house) sessionStorage.setItem(PENDING_HOUSE_KEY, house.slice(0, 40))
    } catch {
      // Storage can be blocked; the name is a convenience, sign-up still works.
    }
    go('/register')
  }

  return (
    <section className="ld-close" aria-labelledby="ld-close-h">
      <form className="ld-close-form" onSubmit={onSubmit}>
        <h2 id="ld-close-h" className="ld-close-line" data-reveal>
          <span className="ld-close-lead">Call your House</span>{' '}
          <span className="ld-close-fill">
            <input
              className="ld-close-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Our Little Mansion"
              aria-label="Your House’s name"
              maxLength={40}
              autoComplete="off"
            />
            <span className="ld-close-and">and</span>
            <button type="submit" className={name.trim() ? 'ld-close-go is-armed' : 'ld-close-go'}>
              start.
            </button>
          </span>
        </h2>
      </form>
      <p className="ld-close-note">
        Next you’ll make an account and set up your House, the shared space everyone at home joins
        with a link.
      </p>
    </section>
  )
}

// The found pictures on the page; sources and full credits in src/assets/landing/credits.json.
const PHOTOS = [
  {
    what: 'Alfama rooftops',
    creator: 'Dale Cruse',
    page: 'https://commons.wikimedia.org/w/index.php?curid=176043191',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    what: 'Tram 28 at the Sé',
    creator: 'Vernaccia',
    page: 'https://commons.wikimedia.org/w/index.php?curid=73559190',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
  {
    what: 'Santa Apolónia station',
    creator: 'Metro Centric',
    page: 'https://commons.wikimedia.org/w/index.php?curid=46459564',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
]

export const LandingFooter: React.FC = () => (
  <footer className="ld-footer">
    <div className="ld-footer-row">
      <ul className="ld-footer-main">
        <li>
          <TransitionLink to="/register">Try Bauhouse free</TransitionLink>
        </li>
        <li>
          <TransitionLink to="/login">Log in</TransitionLink>
        </li>
      </ul>
      <div className="ld-footer-small">
        <ul>
          <li>
            <a href="#lists">Lists</a>
          </li>
          <li>
            <a href="#trips">Trips</a>
          </li>
          <li>
            <a href="#top">Back to top</a>
          </li>
        </ul>
        <p>
          Photos via Wikimedia Commons:{' '}
          {PHOTOS.map((ph, i) => (
            <React.Fragment key={ph.what}>
              {i > 0 && '; '}
              {ph.what} by{' '}
              <a href={ph.page} rel="noopener noreferrer" target="_blank">
                {ph.creator}
              </a>{' '}
              (
              <a href={ph.licenseUrl} rel="noopener noreferrer" target="_blank">
                {ph.license}
              </a>
              )
            </React.Fragment>
          ))}
          .
        </p>
      </div>
    </div>
    <p className="ld-wordmark" aria-hidden="true" data-reveal>
      Bauhouse
    </p>
  </footer>
)
