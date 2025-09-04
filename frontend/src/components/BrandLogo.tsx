import React from 'react'
import logoUrl from '@assets/logo.png'
import { Link } from 'react-router-dom'

// Default size bumped ~30% for stronger presence across pages
export const BrandLogo: React.FC<{ size?: number; to?: string } > = ({ size = 56, to = '/app' }) => {
  const img = (
    <img
      src={logoUrl}
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
      {to ? <Link to={to} aria-label="Go to app home">{img}</Link> : img}
    </div>
  )
}
