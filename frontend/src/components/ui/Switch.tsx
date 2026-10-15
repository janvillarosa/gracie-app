import React from 'react'
import { Switch as AntSwitch } from 'antd'
import './ui.css'

type Props = {
  id?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  'aria-describedby'?: string
  'aria-label'?: string
}

/** The on/off switch: brand yellow when on (the same one UserSettings and Trip settings use). */
export const Switch: React.FC<Props> = ({ onChange, ...rest }) => (
  <AntSwitch {...rest} className="ui-switch" onChange={(v) => onChange(v)} />
)
