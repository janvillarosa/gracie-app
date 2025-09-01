export type User = {
  user_id: string
  name: string
  room_id?: string | null
  created_at: string
  updated_at: string
}

export type RoomView = {
  display_name?: string
  description?: string
  members: string[]
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
  created_at: string
  updated_at: string
}
