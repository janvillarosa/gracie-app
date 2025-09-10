import React from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useAuth } from '@auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { getMe } from '@api/endpoints'
import { BrandLogo } from '@components/BrandLogo'
import { Avatar } from '@components/Avatar'
import { useNavigate } from 'react-router-dom'

export const TopNav: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const me = meQuery.data

  const items: MenuProps['items'] = [
    { key: 'account', label: 'Account Settings' },
    { type: 'divider' as const },
    { key: 'logout', label: 'Logout' },
  ]
  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'account') navigate('/app/account')
    if (key === 'logout') setApiKey(null)
  }

  const seed = me?.avatar_key || me?.name || me?.user_id || 'me'

  return (
    <div className="topnav">
      <BrandLogo />
      <div className="topnav-right">
        <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']} placement="bottomRight">
          <button className="avatar-button" aria-label="Open account menu">
            <Avatar seed={seed} size={50} style={'miniavs'} alt={(me?.name || 'User') + ' avatar'} />
          </button>
        </Dropdown>
      </div>
    </div>
  )
}

export default TopNav
