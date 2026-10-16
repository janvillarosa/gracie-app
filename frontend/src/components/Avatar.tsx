import React, { useEffect, useRef, useState } from 'react'
import { avatarGround, dicebearUrl } from '@lib/dicebear'

/** Avatar sizes, on the control scale so a face is never bigger or smaller than what sits next
 *  to it: `tile` is the 44px control height (the top bar, a settings identity), `stack` the 36px
 *  one (beside Invite and other 36px pills), `row` the lead of a 52px row, `small` a stack on a
 *  line of meta text (a trip's header). */
export const AVATAR_SIZE = { tile: 44, stack: 36, row: 32, small: 24 } as const

type Props = {
  seed: string
  style?: string
  size?: number
  alt?: string
  className?: string
  // The person's name: its first letter shows on the avatar's own colour until the picture
  // arrives, so an avatar is never a blank hole.
  name?: string
  // Above the fold (the top bar, the House's members): load at once instead of lazily.
  eager?: boolean
}

export const Avatar: React.FC<Props> = ({
  seed,
  style = 'miniavs',
  size = 32,
  alt = 'Avatar',
  className,
  name,
  eager,
}) => {
  const src = dicebearUrl(style, seed, size)
  const img = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)
  // A cached picture can finish before React listens for it.
  useEffect(() => {
    setLoaded(!!img.current?.complete && (img.current?.naturalWidth ?? 0) > 0)
  }, [src])
  const initial = (name ?? alt).trim().charAt(0).toUpperCase()
  return (
    <span
      className={['avatar', loaded ? 'is-loaded' : '', className ?? ''].filter(Boolean).join(' ')}
      style={
        {
          width: size,
          height: size,
          background: avatarGround(seed),
          fontSize: Math.round(size * 0.42),
        } as React.CSSProperties
      }
    >
      {!loaded && initial && (
        <span className="avatar-initial" aria-hidden>
          {initial}
        </span>
      )}
      <img
        ref={img}
        src={src}
        width={size}
        height={size}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </span>
  )
}

export default Avatar
