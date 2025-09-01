import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@auth/AuthProvider'
import { getMe, getMyRoom, isNotFound } from '@api/endpoints'
import { RoomPage } from './RoomPage'
import { NoRoomPage } from './NoRoomPage'
import { Card, Alert, Spin, Button, Space } from 'antd'

export const Dashboard: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const key = apiKey!
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(key),
  })
  const roomQuery = useQuery({
    queryKey: ['my-room'],
    queryFn: () => getMyRoom(key),
    retry: false,
  })

  if (meQuery.isLoading || roomQuery.isLoading) {
    return (
      <div className="container">
        <Card><Spin /> Loading…</Card>
      </div>
    )
  }

  if (meQuery.isError) {
    return (
      <div className="container">
        <Card>
          <Alert type="error" message="Session expired. Please log in again." showIcon />
          <div className="spacer" />
          <Space>
            <Button type="primary" onClick={() => setApiKey(null)}>Go to login</Button>
          </Space>
        </Card>
      </div>
    )
  }

  if (roomQuery.isError) {
    if (isNotFound(roomQuery.error)) return <NoRoomPage />
    return (
      <div className="container">
        <Card>
          <Alert type="error" message="Failed to load your house. Please retry." showIcon />
        </Card>
      </div>
    )
  }

  const room = roomQuery.data!
  const me = meQuery.data!
  return <RoomPage room={room} roomId={me.room_id!} userId={me.user_id} />
}
