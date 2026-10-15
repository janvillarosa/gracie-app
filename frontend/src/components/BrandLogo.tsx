import React, { useState } from 'react'
import { HouseMark } from '@components/HouseMark'
import { TransitionLink } from '@components/TransitionLink'
import { welcomeElapsed } from '@lib/welcome'

export const BrandLogo: React.FC<{ size?: number; to?: string; linkLabel?: string }> = ({
  size = 56,
  to = '/app',
  linkLabel = 'Go to app home',
}) => {
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
        <TransitionLink to={to} aria-label={linkLabel}>
          {mark}
        </TransitionLink>
      ) : (
        mark
      )}
    </div>
  )
}
