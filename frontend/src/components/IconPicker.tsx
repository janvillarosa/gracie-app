import React from 'react'
import { Button, Tooltip } from 'antd'
import type { ListIcon } from '@api/types'
import { LIST_ICONS, ICON_EMOJI } from '../icons'

type Props = {
  value?: ListIcon
  onChange: (value?: ListIcon) => void
}

export const IconPicker: React.FC<Props> = ({ value, onChange }) => {
  const noIconSelected = value === undefined
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Tooltip title="No Icon">
        <Button
          type={noIconSelected ? 'primary' : 'default'}
          onClick={() => onChange(undefined)}
          aria-pressed={noIconSelected}
          style={{ height: 40 }}
        >
          No Icon
        </Button>
      </Tooltip>
      {LIST_ICONS.map((ic) => {
        const selected = value === ic
        return (
          <Tooltip key={ic} title={ic.charAt(0) + ic.slice(1).toLowerCase()}>
            <Button
              type={selected ? 'primary' : 'default'}
              onClick={() => onChange(ic)}
              aria-pressed={selected}
              style={{ width: 40, height: 40, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{ICON_EMOJI[ic]}</span>
            </Button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default IconPicker
