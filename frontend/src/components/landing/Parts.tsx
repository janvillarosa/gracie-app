import { ArrowDown } from '@phosphor-icons/react'
import type React from 'react'

/** The page in two: the House's lists, and trip planning. Two plain blocks under the first screen,
 *  each a link to its own part below. */
export const Parts: React.FC = () => (
  <nav className="ld-parts" aria-label="What Bauhouse is for">
    <a href="#lists" className="ld-part is-lists">
      <span className="ld-part-title">Lists for the house</span>
      <span className="ld-part-text">
        Groceries, chores, packing. Type an item and it’s sorted.
      </span>
      <ArrowDown weight="bold" className="ld-part-arrow" aria-hidden="true" />
    </a>
    <a href="#trips" className="ld-part is-trips">
      <span className="ld-part-title">Trip planning</span>
      <span className="ld-part-text">Days, ideas, maps and bookings in one place.</span>
      <ArrowDown weight="bold" className="ld-part-arrow" aria-hidden="true" />
    </a>
  </nav>
)
