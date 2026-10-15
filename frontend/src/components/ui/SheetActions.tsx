import React from 'react'
import './ui.css'

/** Tier 2 of a sheet: the one yellow key and at most one quiet button, under the title and
 *  indented to its column. A sheet has one key and it is always here. */
export const SheetActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="ui-sheet-actions">{children}</div>
)
