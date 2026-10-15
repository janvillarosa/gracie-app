import React from 'react'
import { Button, Tooltip } from 'antd'
import type { ListIcon } from '@api/types'
import { LIST_ICONS, ICON_EMOJI } from '../icons'

type Props<T extends string = ListIcon> = {
  value?: T
  onChange: (value?: T) => void
  // Lists use the house icons; trips pass their own travel set.
  options?: readonly T[]
  emoji?: Record<T, string>
  // Trips always show an icon, so they hide "No icon".
  allowNone?: boolean
}

export function IconPicker<T extends string = ListIcon>({
  value,
  onChange,
  options = LIST_ICONS as unknown as readonly T[],
  emoji = ICON_EMOJI as unknown as Record<T, string>,
  allowNone = true,
}: Props<T>) {
  const noIconSelected = value === undefined
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {allowNone && (
        <Tooltip title="No icon">
          <Button
            type={noIconSelected ? 'primary' : 'default'}
            onClick={() => onChange(undefined)}
            aria-pressed={noIconSelected}
            style={{ height: 40 }}
          >
            No icon
          </Button>
        </Tooltip>
      )}
      {options.map((ic) => {
        const selected = value === ic
        return (
          <Tooltip key={ic} title={ic.charAt(0) + ic.slice(1).toLowerCase().replace('_', ' ')}>
            <Button
              type={selected ? 'primary' : 'default'}
              onClick={() => onChange(ic)}
              aria-pressed={selected}
              aria-label={ic.charAt(0) + ic.slice(1).toLowerCase().replace('_', ' ')}
              style={{
                width: 40,
                height: 40,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{emoji[ic]}</span>
            </Button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default IconPicker
