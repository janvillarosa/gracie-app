import React from 'react'
import './ui.css'

/** A friendly line where a list would be, with an optional key to start it. */
export const EmptyState: React.FC<{
  title?: string
  children?: React.ReactNode
  action?: React.ReactNode
}> = ({ title, children, action }) => (
  <div className="ui-empty">
    {title && <h3>{title}</h3>}
    {children && <p>{children}</p>}
    {action}
  </div>
)
