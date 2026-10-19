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
  // The House's autopilot: off, suggest (the default) or assist. Older servers send only
  // suggestions_off; read it through autopilotModeOf.
  autopilot_mode?: AutopilotMode
  // Deprecated: derived from autopilot_mode for one release.
  suggestions_off?: boolean
}

export type AutopilotMode = 'off' | 'suggest' | 'assist'

export const autopilotModeOf = (room: {
  autopilot_mode?: AutopilotMode
  suggestions_off?: boolean
}): AutopilotMode => room.autopilot_mode ?? (room.suggestions_off ? 'off' : 'suggest')

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
  // "autopilot" when assist mode put it on the list (the row shows the autopilot mark).
  source?: 'autopilot'
  order?: number
  created_at: string
  updated_at: string
}

// What autopilot applied to a list lately (GET .../autopilot).
export type AutopilotReason = { code: string; params?: Record<string, unknown> }

export type AutopilotApplied = {
  action_id: string
  item_id: string
  key: string
  state: 'applied' | 'confirmed'
  run_at: string
  reason: AutopilotReason
  confidence: number
}

export type AutopilotView = {
  mode: AutopilotMode
  applied: AutopilotApplied[]
  suggestions: ListSuggestion[]
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
  // Run mode only: 0 when it is due now, else days until it usually is.
  due_in_days?: number
}

// How the List page spots a shopping run, learned from this person's (or the house's) habits.
export type RunHint = {
  likely: 'expected' | 'unknown' | 'unlikely'
  checks_to_start: number
  idle_end_min: number
  burst_sec: number
  typical?: { minutes: number; items: number }
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

// Which push notifications this person gets, on every device they turned them on.
export type NotificationPrefs = {
  itemAdds: boolean
  autopilot: boolean
  tripReminders: boolean
}

// A browser's push subscription, as the server stores it (PushSubscription.toJSON plus the UA).
export type PushSubscriptionBody = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent: string
}
