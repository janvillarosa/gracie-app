import React from 'react'
import { Paper, Button } from '@components/ui'
import { useAuth } from '@auth/AuthProvider'
import { Link } from 'react-router-dom'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useQuery } from '@tanstack/react-query'
import { getMe, getLists } from '@api/endpoints'
import type { List } from '@api/types'
import { Typography, Space, List as AntList, Alert } from 'antd'
import { ArrowLeft, FolderOpen } from '@phosphor-icons/react'
import { TopNav } from '@components/TopNav'
import { useDocumentTitle } from '@lib/useDocumentTitle'

export const ListsIndex: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle('Lists')

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const roomId = meQuery.data?.room_id as string | undefined

  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
  })

  if (meQuery.isLoading || listsQuery.isLoading) {
    return (
      <div className="container">
        <Paper>Loading your lists…</Paper>
      </div>
    )
  }
  if (!roomId) {
    return (
      <div className="container">
        <Paper>
          <Alert type="error" message="You’re not in a house yet." showIcon />
          <div className="spacer" />
          <Button kind="quiet" onClick={() => navigate('/app')} icon={<ArrowLeft />}>
            Back to house
          </Button>
        </Paper>
      </div>
    )
  }

  const lists: List[] = listsQuery.data ?? []

  return (
    <div className="container">
      <TopNav />
      <Paper>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Lists
            </Typography.Title>
            <Button kind="quiet" onClick={() => navigate('/app')} icon={<ArrowLeft />}>
              Back
            </Button>
          </div>
          {lists.length === 0 ? (
            <Typography.Text type="secondary">
              No lists yet. Go to your House to create one.
            </Typography.Text>
          ) : (
            <AntList
              dataSource={lists}
              renderItem={(l) => (
                <AntList.Item
                  actions={[
                    <Button
                      key="open"
                      kind="quiet"
                      onClick={() => navigate(`/app/lists/${l.list_id}`)}
                      icon={<FolderOpen />}
                    >
                      Open
                    </Button>,
                  ]}
                >
                  <AntList.Item.Meta
                    title={<Link to={`/app/lists/${l.list_id}`}>{l.name}</Link>}
                    description={
                      l.description ? (
                        <Typography.Text type="secondary">{l.description}</Typography.Text>
                      ) : null
                    }
                  />
                </AntList.Item>
              )}
            />
          )}
        </Space>
      </Paper>
    </div>
  )
}
