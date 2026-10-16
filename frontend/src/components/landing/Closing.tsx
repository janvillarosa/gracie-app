import { TransitionLink } from '@components/TransitionLink'
import { promptInstall, useInstallWay } from '@lib/installPrompt'
import { PENDING_HOUSE_KEY } from '@lib/pendingHouse'
import { useTransitionNavigate } from '@lib/viewTransition'
import { DownloadSimple } from '@phosphor-icons/react'
import React, { useRef, useState } from 'react'
import { SetWords, useSetOnScreen } from './SetWords'

const RECEIPT_LINES: Array<[string, string]> = [
  ['Lists', '0.00'],
  ['Trips, with maps and bookings', '0.00'],
  ['Everyone at home', '0.00'],
  ['Every phone and laptop', '0.00'],
]

/** Where Bauhouse runs, and the way onto this device's home screen: a button where the browser
 *  can install it, Safari's one step on iPhone and iPad, nothing more once it's installed. */
const InstallLine: React.FC = () => {
  const way = useInstallWay()
  return (
    <div className="ld-install" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
      <p>
        It works in the browser on iPhones, Android phones and laptops, so it doesn’t matter who has
        which.
        {way === 'ios' && (
          <>
            {' '}
            To put it on your home screen, tap Share, then <b>Add to Home Screen</b>.
          </>
        )}
      </p>
      {way === 'prompt' && (
        <button type="button" className="ld-install-btn" onClick={() => void promptInstall()}>
          <DownloadSimple weight="bold" aria-hidden="true" />
          Install Bauhouse
        </button>
      )}
    </div>
  )
}

/** The price, rung up on a shop receipt: everything in the House comes to 0.00, and a "Nothing
 *  due" stamp lands on it as it scrolls into view. */
export const FreeReceipt: React.FC = () => (
  <section className="ld-free" aria-labelledby="ld-free-h">
    <div className="ld-free-copy">
      <SetWords
        id="ld-free-h"
        className="ld-h2"
        lines={['It costs', 'nothing.']}
        accent={{ word: 'nothing', tone: 'mark' }}
      />
      <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
        There are no ads, there’s no paid plan waiting down the line, and you won’t need a card. Add
        everyone you live with and make as many lists and trips as you want.
      </p>
      <InstallLine />
      <TransitionLink
        to="/register"
        className="ld-key is-large"
        data-reveal
        style={{ '--i': 3 } as React.CSSProperties}
      >
        Get started free
      </TransitionLink>
    </div>
    <div className="ld-receipt-wrap" data-reveal>
      <div
        className="ld-receipt"
        role="img"
        aria-label="A receipt for a House on Bauhouse: lists, trips, housemates and every device all come to 0.00. Total 0.00, nothing due."
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
  const line = useRef<HTMLHeadingElement>(null)
  const lineSet = useSetOnScreen(line)
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
      <div className="ld-close-copy">
        <form className="ld-close-form" onSubmit={onSubmit}>
          <h2
            id="ld-close-h"
            className="ld-close-line ld-set"
            ref={line}
            data-set={lineSet ? '' : undefined}
          >
            <span className="ld-close-lead">
              {['Call', 'your', 'House'].map((word, i) => (
                <React.Fragment key={word}>
                  <span className="ld-w">
                    <span className="ld-w-in" style={{ '--i': i } as React.CSSProperties}>
                      {word}
                    </span>
                  </span>{' '}
                </React.Fragment>
              ))}
            </span>{' '}
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
              <button
                type="submit"
                className={name.trim() ? 'ld-close-go is-armed' : 'ld-close-go'}
              >
                start.
              </button>
            </span>
          </h2>
        </form>
        <p className="ld-close-note">
          Next you’ll make an account and set up your House. Everyone else joins with a link you
          send them.
        </p>
      </div>
    </section>
  )
}

// The found pictures on the page; sources and full credits in src/assets/landing/credits.json.
const PHOTOS = [
  {
    what: 'São Bento station',
    creator: 'Michael Gaylard',
    page: 'https://commons.wikimedia.org/wiki/File:Exploring_the_Azulejo-Adorned_Grand_Hall_of_S%C3%A3o_Bento_Station_(55248917165).jpg',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    what: 'Ribeira',
    creator: 'Jakub Hałun',
    page: 'https://commons.wikimedia.org/wiki/File:Rabelo_boats_and_Ribeira_seen_from_Cais_de_Gaia,_20250605_1623_9879.jpg',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
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
          <TransitionLink to="/register">Get started free</TransitionLink>
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
