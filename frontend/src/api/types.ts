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
  // What the House's mode includes (the server's one feature table); read it through hasFeature.
  autopilot_features?: AutopilotFeature[]
  // Deprecated: derived from autopilot_mode for one release.
  suggestions_off?: boolean
}

export type AutopilotMode = 'off' | 'suggest' | 'assist'

export type AutopilotFeature = 'suggestions' | 'auto_add' | 'run_hint' | 'up_next'

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

// A live list item with a spot on the House's route through the shop, checked or not.
export type RouteItem = { item_id: string; key: string; spot: number; done: boolean }

// Up next: the learned route over this list and the run in progress, if any.
export type AutopilotUpNext = {
  // The House is probably shopping now: a run is on, or its usual window is open.
  ready: boolean
  run?: { started_at: string; anchor_item_id?: string }
  route: RouteItem[]
}

export type AutopilotView = {
  mode: AutopilotMode
  features: AutopilotFeature[]
  // The slips this list has something to show, front to back: autopilot floats one at a time.
  stack: AutopilotFeature[]
  up_next?: AutopilotUpNext
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
