import React from 'react'
import { dicebearUrl } from '@lib/dicebear'

type Props = {
  seed: string
  style?: string
  size?: number
  alt?: string
  className?: string
}

export const Avatar: React.FC<Props> = ({ seed, style = 'miniavs', size = 32, alt = 'Avatar', className }) => {
  const src = dicebearUrl(style, seed, size)
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      className={className}
      style={{ borderRadius: '50%', display: 'inline-block' }}
    />
  )
}

export default Avatar
