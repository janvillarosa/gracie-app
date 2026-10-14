import React, { useRef } from 'react'
import { Dropdown } from 'antd'
import { CaretLeft } from '@phosphor-icons/react'
import type { MenuProps } from 'antd'
import { useAuth } from '@auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { getMe } from '@api/endpoints'
import { BrandLogo } from '@components/BrandLogo'
import { Avatar } from '@components/Avatar'
import { TransitionLink } from '@components/TransitionLink'
import { useTransitionNavigate, withViewTransition } from '@lib/viewTransition'

type Props = {
  // Replaces the logo with a way back, e.g. from a list to its house.
  back?: { to: string; label: string }
}

export const TopNav: React.FC<Props> = ({ back }) => {
  const { apiKey, setApiKey } = useAuth()
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
  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'account') navigate('/app/account')
    if (key === 'logout') withViewTransition(() => setApiKey(null))
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
          trigger={['click']}
          placement="bottomRight"
        >
          <button className="avatar-button" aria-label="Open account menu">
            {/* Until we know who you are, a blank disc instead of a stranger's face */}
            {me ? (
              <Avatar
                seed={seed}
                size={50}
                style={'miniavs'}
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
