import React from 'react'
import logo112 from '@assets/logo-112.png'
import logo168 from '@assets/logo-168.png'
import { TransitionLink } from '@components/TransitionLink'

// Default size bumped ~30% for stronger presence across pages
export const BrandLogo: React.FC<{ size?: number; to?: string }> = ({ size = 56, to = '/app' }) => {
  const img = (
    <img
      src={logo112}
      srcSet={`${logo112} 1x, ${logo168} 2x`}
      alt="Bauhouse"
      width={size}
      height={size}
      className="brand-logo-img"
      decoding="async"
      loading="eager"
    />
  )
  return (
    <div className="brand-logo" aria-label="Bauhouse logo">
      {to ? (
        <TransitionLink to={to} aria-label="Go to app home">
          {img}
        </TransitionLink>
      ) : (
        img
      )}
    </div>
  )
}
