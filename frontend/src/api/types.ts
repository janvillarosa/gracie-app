export type User = {
  user_id: string
  name: string
  username?: string
  room_id?: string | null
  created_at: string
  updated_at: string
  avatar_key?: string
  avatar_style?: string
}

export type RoomView = {
  display_name?: string
  description?: string
  members: string[]
  members_meta?: { name: string; avatar_key: string }[]
  created_at: string
  updated_at: string
  my_deletion_vote?: boolean
}

export type CreateUserResponse = {
  user: User
  api_key: string
}

// Lists / Items
export type List = {
  list_id: string
  room_id: string
  name: string
  description?: string
  icon?: ListIcon
  deletion_votes?: Record<string, string>
  is_deleted: boolean
  created_at: string
  updated_at: string
}

export type ListItem = {
  item_id: string
  list_id: string
  room_id: string
  description: string
  completed: boolean
  order?: number
  created_at: string
  updated_at: string
}

export type ListIcon =
  | 'HOUSE'
  | 'CAR'
  | 'PLANE'
  | 'PENCIL'
  | 'APPLE'
  | 'BROCCOLI'
  | 'TV'
  | 'SUNFLOWER'
