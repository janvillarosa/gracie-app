import React from 'react'
import { AVATAR_SIZE, Avatar } from '@components/Avatar'

export type StackMember = { name: string; avatar_key?: string; user_id?: string }

type Props = {
  members: StackMember[]
  // The whole stack's name for screen readers ("Shared with Mia and Sam"): the faces themselves
  // are decorative, so the group is one image, not a tab stop per face.
  label: string
  size?: number
  // More people than this: show one fewer face and a "+N" chip.
  max?: number
  className?: string
}

/** The one way the app shows who is in something: faces overlapping by a quarter of their
 *  size, each on a paper ring, dealt in from the left one after another when they first appear
 *  (only when motion is allowed). The House page and a trip's header both use it, so a stack
 *  looks and arrives the same everywhere. */
export const AvatarStack: React.FC<Props> = ({
  members,
  label,
  size = AVATAR_SIZE.stack,
  max = 4,
  className,
}) => {
  const extra = members.length > max ? members.length - (max - 1) : 0
  const shown = extra ? members.slice(0, max - 1) : members
  return (
    <span
      className={['avatar-stack', className ?? ''].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      style={{ '--face': `${size}px` } as React.CSSProperties}
    >
      {shown.map((m, i) => (
        <span
          key={m.user_id ?? `${m.name}-${i}`}
          className="avatar-stack-face"
          title={m.name}
          style={{ '--i': i } as React.CSSProperties}
        >
          <Avatar seed={m.avatar_key ?? m.name} size={size} name={m.name} alt="" eager />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="avatar-stack-more"
          aria-hidden
          style={{ '--i': shown.length } as React.CSSProperties}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

export default AvatarStack
