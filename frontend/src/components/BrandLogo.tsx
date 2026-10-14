import React, { useState } from 'react'
import { HouseMark } from '@components/HouseMark'
import { TransitionLink } from '@components/TransitionLink'
import { welcomeElapsed } from '@lib/welcome'

export const BrandLogo: React.FC<{ size?: number; to?: string }> = ({ size = 56, to = '/app' }) => {
  // Read once on mount: a logo mounted during the post-login welcome joins it in progress.
  const [welcomeAt] = useState(welcomeElapsed)
  const mark = (
    <HouseMark
      size={size}
      label="Bauhouse"
      className={welcomeAt === null ? undefined : 'is-welcome'}
      style={
        welcomeAt === null
          ? undefined
          : ({ '--welcome-offset': `-${Math.round(welcomeAt)}ms` } as React.CSSProperties)
      }
    />
  )
  return (
    <div className="brand-logo" aria-label="Bauhouse logo">
      {to ? (
        <TransitionLink to={to} aria-label="Go to app home">
          {mark}
        </TransitionLink>
      ) : (
        mark
      )}
    </div>
  )
}
