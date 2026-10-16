export type User = {
  user_id: string
  name: string
  username?: string
  room_id?: string | null
  created_at: string
  updated_at: string
  avatar_key?: string
  avatar_style?: string
  // Per-account preferences (kept on the account, not on the device).
  preferences?: { trips_show_next_stop?: boolean }
}

export type RoomView = {
  display_name?: string
  description?: string
  members: string[]
  // user_id is optional: the room view does not send it yet, so "Added by" names need it.
  members_meta?: { name: string; avatar_key: string; user_id?: string }[]
  created_at: string
  updated_at: string
  my_deletion_vote?: boolean
  // How many current members have voted to delete the House.
  deletion_votes?: number
  // Smart suggestions are on unless the house turned them off.
  suggestions_off?: boolean
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
  notes?: string
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
  quantity?: string
  unit?: string
  category?: string
  is_starred?: boolean
  is_archived?: boolean
  completed: boolean
  order?: number
  created_at: string
  updated_at: string
}

export type PantryItem = {
  description: string
  category: string
  quantity: string
  unit: string
  times_added: number
  last_added_at: string
  // From the built-in grocery set, not this house's history.
  common: boolean
}

// Something the house usually adds around now, shown above a list's items.
export type ListSuggestion = {
  // Normalized text: what the ignore call needs.
  key: string
  description: string
  quantity?: string
  unit?: string
  category?: string
  every_days: number
  score: number
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
