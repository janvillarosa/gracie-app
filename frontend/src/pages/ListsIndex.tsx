import React from 'react'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMe, getLists } from '@api/endpoints'
import type { List } from '@api/types'
import { Card, Typography, Space, Button, List as AntList, Alert } from 'antd'
import { ArrowLeftOutlined, FolderOpenOutlined } from '@ant-design/icons'

export const ListsIndex: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const roomId = meQuery.data?.room_id as string | undefined

  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
  })

  if (meQuery.isLoading || listsQuery.isLoading) {
    return <div className="container"><Card>Loading…</Card></div>
  }
  if (!roomId) {
    return (
      <div className="container">
        <Card>
          <Alert type="error" message="No house found." showIcon />
          <div className="spacer" />
          <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back to House</Button>
        </Card>
      </div>
    )
  }

  const lists: List[] = listsQuery.data ?? []

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Title level={3} style={{ margin: 0 }}>Lists</Typography.Title>
            <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
          </div>
          {lists.length === 0 ? (
            <Typography.Text type="secondary">No lists yet. Go to your House to create one.</Typography.Text>
          ) : (
            <AntList
              dataSource={lists}
              renderItem={(l) => (
                <AntList.Item
                  actions={[
                    <Button key="open" type="primary" onClick={() => navigate(`/app/lists/${l.list_id}`)} icon={<FolderOpenOutlined />}>Open</Button>,
                  ]}
                >
                  <AntList.Item.Meta
                    title={<Link to={`/app/lists/${l.list_id}`}>{l.name}</Link>}
                    description={l.description ? <Typography.Text type="secondary">{l.description}</Typography.Text> : null}
                  />
                </AntList.Item>
              )}
            />
          )}
        </Space>
      </Card>
    </div>
  )
}
