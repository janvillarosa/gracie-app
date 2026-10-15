import station from '@assets/landing/santa-apolonia.jpg'
import tram from '@assets/landing/tram-28.jpg'
import { Bed, Train } from '@phosphor-icons/react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { AddBarStill, Box, ListHead, Pills } from './appUi'

// Four sheets that stack as the page scrolls, the way the List page stacks its paper. Each holds
// a piece of the real interface, drawn as the app draws it, with an example House's content.

const AddFragment: React.FC = () => (
  <div className="ld-frag is-add" data-ui aria-hidden="true">
    <div className="ld-app-card is-flat">
      <ul className="ld-rows">
        <li className="ld-row is-static">
          <span className="ld-row-hit">
            <Box />
            <span className="ld-row-title">Sourdough</span>
          </span>
          <span className="ld-stamp is-bakery">Bakery</span>
        </li>
      </ul>
      <ul className="ld-slips">
        <li className="is-hot">
          <span>
            <b>Oa</b>t milk
          </span>
          <span className="ld-stamp is-dairy">Dairy</span>
        </li>
        <li>
          <span>
            <b>Oa</b>ts
          </span>
          <span className="ld-stamp is-pantry">Pantry</span>
        </li>
        <li>
          <span>
            Olive <b>oil</b>
          </span>
          <span className="ld-stamp is-pantry">Pantry</span>
        </li>
      </ul>
      <AddBarStill text="oa" placeholder="Add an item" />
    </div>
    <p className="ld-frag-foot">What your house buys most comes up first.</p>
  </div>
)

// The stop and the booking the sheets' photos show; each gets the highlighter so the picture
// and its line read as one.
const TRAM = 'Tram 28 to Graça'

const STOPS: Array<{ time: string; what: string; place?: string; pip: string; done?: boolean }> = [
  { time: '09:30', what: 'Pastéis de Belém', pip: 'food', done: true },
  { time: '11:00', what: TRAM, place: 'Sé de Lisboa', pip: 'transport' },
  { time: '14:00', what: 'Castelo de São Jorge', place: 'São Jorge Castle', pip: 'sight' },
  { time: '20:00', what: 'Dinner in Alfama', pip: 'food' },
]

const DayFragment: React.FC = () => (
  <div className="ld-frag is-day" data-ui aria-hidden="true">
    <div className="ld-app-card is-flat">
      <Pills tabs={['Plan', 'Ideas', 'Bookings']} on={0} />
      <p className="ld-day">
        <b>Sat 25</b> Lisbon
      </p>
      {STOPS.map((s) => (
        <div
          key={s.what}
          className={['ld-dayrow', s.done ? 'is-done' : '', s.what === TRAM ? 'is-marked' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <Box done={s.done} />
          <span className="ld-time">{s.time}</span>
          <span className="ld-dayrow-text">
            <span className="ld-dayrow-what">{s.what}</span>
            {s.place && <span className="ld-dayrow-place">{s.place}</span>}
          </span>
          <span className={`ld-pip is-${s.pip}`} />
        </div>
      ))}
      <AddBarStill chip="Sat 25" placeholder="Add a place, plan or idea" />
    </div>
  </div>
)

const BookingFragment: React.FC = () => (
  <div className="ld-frag is-booking" data-ui aria-hidden="true">
    <div className="ld-app-card is-flat">
      <Pills tabs={['Plan', 'Bookings']} on={1} />
      <div className="ld-bookrow is-on">
        <Train weight="bold" />
        <span>
          <b>Train to Porto</b>
          Next · Sun 26 09:09
        </span>
      </div>
      <div className="ld-bookrow">
        <Bed weight="bold" />
        <span>
          <b>Casa do Pátio</b>
          Sat 25 to Tue 28 · 3 nights
        </span>
      </div>
      <dl className="ld-details">
        <div>
          <dt>Depart</dt>
          <dd>Sun 26 Oct · 09:09</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>
            <span className="ld-mark">Santa Apolónia</span>
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>Porto Campanhã</dd>
        </div>
        <div>
          <dt>Code</dt>
          <dd className="ld-code">7HQ2KD</dd>
        </div>
      </dl>
    </div>
  </div>
)

const PackingFragment: React.FC = () => (
  <div className="ld-frag is-packing" data-ui aria-hidden="true">
    <div className="ld-app-card is-flat">
      <ListHead
        icon="🧳" // taste-skill-ignore: the app’s own list icon (lists pick an emoji)
        title="Packing"
        meta="3 to get · for Lisbon & Porto"
      />
      <ul className="ld-rows">
        {[
          ['Plug adapters', '2'],
          ['Sunscreen', ''],
          ['Rain jacket, just in case', ''],
        ].map(([what, qty]) => (
          <li key={what} className="ld-row is-static">
            <span className="ld-row-hit">
              <Box />
              <span className="ld-row-title">
                {what}
                {qty && <span className="ld-qty">{qty}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="ld-done-toggle is-still">Show checked-off items (1)</p>
    </div>
  </div>
)

type Sheet = {
  id: string
  tone: 'ink' | 'blue' | 'red' | 'paper'
  name: string
  text: string
  frag: React.ReactNode
  photo?: { src: string; w: number; h: number; alt: string; caption: string }
}

const SHEETS: Sheet[] = [
  {
    id: 'day',
    tone: 'blue',
    name: 'Day by day',
    text: 'Add a stop the way you add a list item: a place, a day, and a time if you have one. Maybes wait in Ideas until someone decides.',
    frag: <DayFragment />,
    photo: {
      src: tram,
      w: 819,
      h: 1000,
      alt: 'A red Lisbon tram passing the Sé cathedral on a cobbled street',
      caption: 'The 11:00 stop on Saturday’s plan: Tram 28, on its way past the Sé up to Graça.',
    },
  },
  {
    id: 'bookings',
    tone: 'red',
    name: 'Bookings at the counter',
    text: 'Flights, stays and tickets live here with their codes, so nobody’s digging through email at the check-in desk.',
    frag: <BookingFragment />,
    photo: {
      src: station,
      w: 1000,
      h: 656,
      alt: 'The platforms of Santa Apolónia station in Lisbon under its long roof',
      caption: 'Santa Apolónia, where Sunday’s 09:09 to Porto leaves from.',
    },
  },
  {
    id: 'packing',
    tone: 'paper',
    name: 'Packing is just a list',
    text: 'The trip’s packing list is a normal Bauhouse list, so everyone packs from the same one.',
    frag: <PackingFragment />,
  },
]

/** The lists part's second beat: a single ink sheet (not stacked) about what the add bar learns. */
export const LearnsSheet: React.FC = () => (
  <div className="ld-capsheet is-ink is-static">
    <h3 className="ld-capsheet-name">It learns your shop</h3>
    <div className="ld-capsheet-body">
      <div className="ld-capsheet-side">
        <p className="ld-capsheet-text">
          After a couple of letters, Bauhouse suggests what your house usually buys, so the weekly
          shop goes quicker.
        </p>
      </div>
      <div className="ld-capsheet-frag" data-reveal>
        <AddFragment />
      </div>
    </div>
  </div>
)

/** The sheets stack like folders in a drawer, so each must be at least as tall as the ones under
 *  it, or a taller sheet's lower half pokes out beneath a shorter one that slides over it. Every
 *  sheet takes the height of the tallest, measured from the content as it lays out now (fonts,
 *  photos and the viewport width all change it), never a fixed number. */
function useEqualSheets(list: React.RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    const ul = list.current
    if (!ul) return
    let frame = 0
    const measure = () => {
      frame = 0
      ul.style.setProperty('--sheet-h', '0px')
      let tallest = 0
      for (const li of Array.from(ul.children) as HTMLElement[]) {
        tallest = Math.max(tallest, li.offsetHeight)
      }
      ul.style.setProperty('--sheet-h', `${tallest}px`)
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('resize', queue)
    document.fonts?.ready.then(queue).catch(() => {})
    for (const img of Array.from(ul.querySelectorAll('img'))) img.addEventListener('load', queue)
    return () => {
      window.removeEventListener('resize', queue)
      for (const img of Array.from(ul.querySelectorAll('img')))
        img.removeEventListener('load', queue)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [list])
}

export const Capabilities: React.FC = () => {
  const list = useRef<HTMLUListElement>(null)
  useEqualSheets(list)
  return (
    <section className="ld-caps" id="trips" aria-labelledby="ld-caps-h">
      <div className="ld-caps-intro">
        <h2 id="ld-caps-h" className="ld-h2" data-reveal>
          Plan the trip in one place.
        </h2>
        <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
          No Google Sheet of flights and hotels, no shared Doc of ideas, no group chat to scroll
          back through. Give each stop a day and a time, keep the maybes in Ideas, and see it all on
          a map. Bookings sit alongside with their confirmation codes.
        </p>
      </div>
      <ul className="ld-sheets" ref={list}>
        {SHEETS.map((s, i) => (
          <li
            key={s.id}
            className={`ld-capsheet is-${s.tone}`}
            style={{ '--n': i } as React.CSSProperties}
          >
            <h3 className="ld-capsheet-name">{s.name}</h3>
            <div className="ld-capsheet-body">
              <div className="ld-capsheet-side">
                {s.photo && (
                  <figure className="ld-capsheet-photo">
                    <img
                      src={s.photo.src}
                      width={s.photo.w}
                      height={s.photo.h}
                      alt={s.photo.alt}
                      loading="lazy"
                      decoding="async"
                    />
                    <figcaption>{s.photo.caption}</figcaption>
                  </figure>
                )}
                <p className="ld-capsheet-text">{s.text}</p>
              </div>
              <div className="ld-capsheet-frag" data-reveal>
                {s.frag}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
