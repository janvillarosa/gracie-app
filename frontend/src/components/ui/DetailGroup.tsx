import React from 'react'
import './ui.css'

/** Tier 3 of a sheet: the editable properties in one tinted group of NavRows, no outer border,
 *  hairlines between rows. */
export const DetailGroup: React.FC<{
  label?: string
  className?: string
  children: React.ReactNode
}> = ({ label, className, children }) => (
  <div
    className={['ui-detail-group', className ?? ''].filter(Boolean).join(' ')}
    role="group"
    aria-label={label}
  >
    {children}
  </div>
)
