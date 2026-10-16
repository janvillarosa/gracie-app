import React from 'react'
import { HouseMark } from '@components/HouseMark'

/** The top bar as it will be, before the page that owns it has loaded: the logo where it sits
 *  and the avatar's empty disc. Static (no queries, no menu), so a loading frame can draw it and
 *  the page underneath lands at the same height instead of dropping when the real bar arrives. */
export const NavShell: React.FC = () => (
  <div className="topnav" aria-hidden>
    <div className="brand-logo">
      <HouseMark size={56} />
    </div>
    <div className="topnav-right">
      <span className="avatar-placeholder" />
    </div>
  </div>
)
