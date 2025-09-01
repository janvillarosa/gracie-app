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
}

export type CreateUserResponse = {
  user: User
  api_key: string
}
