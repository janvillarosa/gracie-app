import React from 'react'
import { Button } from './Button'
import './ui.css'

/** Tier 4 of a sheet: one quiet line ("Added by Mia · Tue") with a red Delete on the right. */
export const SheetFooter: React.FC<{
  who?: string
  onDelete?: () => void
  deleteLabel?: string
  children?: React.ReactNode
}> = ({ who, onDelete, deleteLabel = 'Delete', children }) => (
  <footer className="ui-sheet-footer">
    <span className="ui-sheet-who">{who ?? children}</span>
    {onDelete && (
      <Button kind="text" danger onClick={onDelete}>
        {deleteLabel}
      </Button>
    )}
  </footer>
)
