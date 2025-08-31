export type User = {
  user_id: string
  name: string
  room_id?: string | null
  created_at: string
  updated_at: string
}

export type Room = {
  room_id: string
  member_ids: string[]
  share_token?: string | null
  deletion_votes: Record<string, string>
  created_at: string
  updated_at: string
}

export type CreateUserResponse = {
  user: User
  api_key: string
}

