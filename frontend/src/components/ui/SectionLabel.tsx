import React from 'react'
import './ui.css'

/** A small uppercase muted label above a group: "This trip", "Just for you". */
export const SectionLabel: React.FC<{ id?: string; children: React.ReactNode }> = ({
  id,
  children,
}) => (
  <h2 id={id} className="ui-section-label">
    {children}
  </h2>
)
