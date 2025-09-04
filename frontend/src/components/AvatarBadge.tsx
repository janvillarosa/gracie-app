import React from 'react'
import { Tooltip } from 'antd'
import { Avatar } from '@components/Avatar'

type Props = {
  seed: string
  name: string
  size?: number
  style?: string
}

export const AvatarBadge: React.FC<Props> = ({ seed, name, size = 20, style = 'adventurer-neutral' }) => {
  return (
    <Tooltip title={name} trigger={["hover", "focus", "click"]} placement="top">
      <span role="img" aria-label={name} tabIndex={0} style={{ display: 'inline-flex' }}>
        <Avatar seed={seed} size={size} style={style} />
      </span>
    </Tooltip>
  )
}

export default AvatarBadge

