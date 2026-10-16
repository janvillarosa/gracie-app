import React, { useRef, useState } from 'react'
import { Dropdown } from 'antd'
import { CaretLeft } from '@phosphor-icons/react'
import type { MenuProps } from 'antd'
import { useAuth } from '@auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { getMe } from '@api/endpoints'
import { BrandLogo } from '@components/BrandLogo'
import { AVATAR_SIZE, Avatar } from '@components/Avatar'
import { TransitionLink } from '@components/TransitionLink'
import { useTransitionNavigate, withViewTransition } from '@lib/viewTransition'

type Props = {
  // Replaces the logo with a way back, e.g. from a list to its house.
  back?: { to: string; label: string }
}

export const TopNav: React.FC<Props> = ({ back }) => {
  const { apiKey, signOut } = useAuth()
  const navigate = useTransitionNavigate()
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const me = meQuery.data
  // The avatar fades in only when it replaces the placeholder, not on every page
  const hadPlaceholder = useRef(false)
  if (!me) hadPlaceholder.current = true

  const items: MenuProps['items'] = [
    { key: 'account', label: 'Account settings' },
    { type: 'divider' as const },
    { key: 'logout', label: 'Log out' },
  ]
  // The menu is shut before the page changes, so it is not caught in the cross-fade and
  // ghosted across both pages.
  const [menuOpen, setMenuOpen] = useState(false)
  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    setMenuOpen(false)
    requestAnimationFrame(() => {
      if (key === 'account') navigate('/app/account')
      if (key === 'logout') void signOut('user', withViewTransition)
    })
  }

  const seed = me?.avatar_key || me?.name || me?.user_id || 'me'

  return (
    <div className="topnav">
      {back ? (
        <TransitionLink to={back.to} className="topnav-back" aria-label={`Back to ${back.label}`}>
          <CaretLeft size={22} weight="bold" aria-hidden />
          <span className="topnav-back-label">{back.label}</span>
        </TransitionLink>
      ) : (
        <BrandLogo />
      )}
      <div className="topnav-right">
        <Dropdown
          menu={{ items, onClick: onMenuClick }}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          rootClassName="topnav-menu"
          trigger={['click']}
          placement="bottomRight"
        >
          <button className="avatar-button" aria-label="Open account menu">
            {/* Until we know who you are, a blank disc instead of a stranger's face */}
            {me ? (
              <Avatar
                seed={seed}
                size={AVATAR_SIZE.tile}
                style={'miniavs'}
                name={me.name}
                eager
                alt={(me.name || 'User') + ' avatar'}
                className={hadPlaceholder.current ? 'avatar-in' : undefined}
              />
            ) : (
              <span className="avatar-placeholder" />
            )}
          </button>
        </Dropdown>
      </div>
    </div>
  )
}

export default TopNav
