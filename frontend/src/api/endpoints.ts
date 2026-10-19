import { apiFetch, ApiError } from './client'
import type {
  AutopilotMode,
  AutopilotView,
  CreateUserResponse,
  RoomView,
  User,
  List,
  ListItem,
  ListIcon,
  ListSuggestion,
  NotificationPrefs,
  PushSubscriptionBody,
  TestAction,
  RunHint,
  PantryItem,
} from './types'

export async function registerUser(name: string): Promise<CreateUserResponse> {
  return apiFetch<CreateUserResponse>('/users', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function registerAuth(
  username: string,
  password: string,
  name: string,
): Promise<void> {
  await apiFetch<void>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, name }),
  })
}

export async function loginAuth(
  username: string,
  password: string,
): Promise<{ user: User; api_key: string }> {
  return apiFetch<{ user: User; api_key: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function getMe(apiKey: string): Promise<User> {
  return apiFetch<User>('/me', { apiKey })
}

// The server answers 204: callers refetch ['me'] to see the new name.
export async function updateMe(apiKey: string, name: string): Promise<void> {
  await apiFetch<void>('/me', { method: 'PUT', apiKey, body: JSON.stringify({ name }) })
}

export async function updateMyProfile(
  apiKey: string,
  params: { name?: string; username?: string },
): Promise<void> {
  await apiFetch<void>('/me', { method: 'PATCH', apiKey, body: JSON.stringify(params) })
}

export async function getMyRoom(apiKey: string): Promise<RoomView> {
  return apiFetch<RoomView>('/rooms/me', { apiKey })
}

export async function createRoom(apiKey: string): Promise<RoomView> {
  return apiFetch<RoomView>('/rooms', { method: 'POST', apiKey })
}

// The House's current invite code; minted only if it has none. Reading never replaces a code.
export async function getShareCode(apiKey: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/rooms/share', { apiKey })
}

// A new invite code: the old one stops working.
export async function rotateShare(apiKey: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/rooms/share', { method: 'POST', apiKey })
}

export async function joinRoomByToken(apiKey: string, token: string): Promise<RoomView> {
  return apiFetch<RoomView>(`/rooms/join`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify({ token }),
  })
}

export async function voteDeletion(apiKey: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/rooms/deletion/vote`, { method: 'POST', apiKey })
}

export async function cancelDeletion(apiKey: string): Promise<void> {
  return apiFetch<void>(`/rooms/deletion/cancel`, { method: 'POST', apiKey })
}

export async function updateRoomSettings(
  apiKey: string,
  params: { display_name?: string; description?: string; autopilot_mode?: AutopilotMode },
): Promise<RoomView> {
  return apiFetch<RoomView>(`/rooms/settings`, {
    method: 'PUT',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function getRoomPantry(apiKey: string, roomId: string): Promise<PantryItem[]> {
  return apiFetch<PantryItem[]>(`/rooms/${roomId}/pantry`, { apiKey })
}

export async function changeMyPassword(
  apiKey: string,
  params: { current_password?: string; new_password: string },
): Promise<{ api_key: string }> {
  return apiFetch<{ api_key: string }>(`/me/password`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function deleteMyAccount(apiKey: string): Promise<void> {
  await apiFetch<void>('/me', {
    method: 'DELETE',
    apiKey,
    body: JSON.stringify({ confirm: 'DELETE' }),
  })
}

export function isNotFound(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 404
}

export function isForbidden(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 403
}

export function isUnauthorized(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 401
}

export function isConflict(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 409
}

// Lists API
export async function getLists(apiKey: string, roomId: string): Promise<List[]> {
  return apiFetch<List[]>(`/rooms/${roomId}/lists`, { apiKey })
}

export async function createList(
  apiKey: string,
  roomId: string,
  params: { name: string; description?: string; icon?: ListIcon },
): Promise<List> {
  return apiFetch<List>(`/rooms/${roomId}/lists`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function updateList(
  apiKey: string,
  roomId: string,
  listId: string,
  params: { name?: string; description?: string; icon?: ListIcon | ''; notes?: string },
): Promise<List> {
  return apiFetch<List>(`/rooms/${roomId}/lists/${listId}`, {
    method: 'PATCH',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function voteListDeletion(
  apiKey: string,
  roomId: string,
  listId: string,
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/rooms/${roomId}/lists/${listId}/deletion/vote`, {
    method: 'POST',
    apiKey,
  })
}

export async function cancelListDeletion(
  apiKey: string,
  roomId: string,
  listId: string,
): Promise<void> {
  return apiFetch<void>(`/rooms/${roomId}/lists/${listId}/deletion/cancel`, {
    method: 'POST',
    apiKey,
  })
}

export async function clearListItems(
  apiKey: string,
  roomId: string,
  listId: string,
): Promise<void> {
  await apiFetch<void>(`/rooms/${roomId}/lists/${listId}/clear`, { method: 'POST', apiKey })
}

export async function getListItems(
  apiKey: string,
  roomId: string,
  listId: string,
  includeCompleted = false,
): Promise<ListItem[]> {
  const q = includeCompleted ? '?include_completed=true' : '?include_completed=false'
  return apiFetch<ListItem[]>(`/rooms/${roomId}/lists/${listId}/items${q}`, { apiKey })
}

export async function createListItem(
  apiKey: string,
  roomId: string,
  listId: string,
  params: {
    description: string
    quantity?: string
    unit?: string
    category?: string
    // 'suggestion' when the add came from tapping a smart suggestion.
    source?: 'suggestion'
  },
): Promise<ListItem> {
  return apiFetch<ListItem>(`/rooms/${roomId}/lists/${listId}/items`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify(params),
  })
}

/** The list's autopilot: the House's mode, its slip stack, what it applied lately and its
 *  suggestions. `during: 'run'` (mid-shop) widens the suggestions to what comes due before the
 *  next run. */
export async function getListAutopilot(
  apiKey: string,
  roomId: string,
  listId: string,
  during?: 'run',
): Promise<AutopilotView> {
  return apiFetch<AutopilotView>(
    `/rooms/${roomId}/lists/${listId}/autopilot${during ? `?during=${during}` : ''}`,
    { apiKey },
  )
}

/** Takes back one thing autopilot added: the item leaves the list. */
export async function undoAutopilotAction(
  apiKey: string,
  roomId: string,
  listId: string,
  actionId: string,
): Promise<void> {
  return apiFetch<void>(`/rooms/${roomId}/lists/${listId}/autopilot/${actionId}/undo`, {
    method: 'POST',
    apiKey,
  })
}

export async function getListSuggestions(
  apiKey: string,
  roomId: string,
  listId: string,
  during?: 'run',
): Promise<ListSuggestion[]> {
  const r = await apiFetch<{ suggestions: ListSuggestion[] }>(
    `/rooms/${roomId}/lists/${listId}/suggestions?limit=1${during ? `&during=${during}` : ''}`,
    { apiKey },
  )
  return r.suggestions
}

export async function ignoreListSuggestion(
  apiKey: string,
  roomId: string,
  listId: string,
  key: string,
  during?: 'run',
): Promise<void> {
  await apiFetch<void>(`/rooms/${roomId}/lists/${listId}/suggestions/ignore`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify(during ? { key, during } : { key }),
  })
}

export async function getRunHint(apiKey: string, roomId: string, listId: string): Promise<RunHint> {
  const r = await apiFetch<{ run_hint: RunHint }>(`/rooms/${roomId}/lists/${listId}/run-hint`, {
    apiKey,
  })
  return r.run_hint
}

export async function updateListItem(
  apiKey: string,
  roomId: string,
  listId: string,
  itemId: string,
  params: {
    description?: string
    completed?: boolean
    quantity?: string
    unit?: string
    category?: string
    starred?: boolean
  },
): Promise<ListItem> {
  return apiFetch<ListItem>(`/rooms/${roomId}/lists/${listId}/items/${itemId}`, {
    method: 'PATCH',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function deleteListItem(
  apiKey: string,
  roomId: string,
  listId: string,
  itemId: string,
): Promise<void> {
  return apiFetch<void>(`/rooms/${roomId}/lists/${listId}/items/${itemId}`, {
    method: 'DELETE',
    apiKey,
  })
}

export async function reorderListItem(
  apiKey: string,
  roomId: string,
  listId: string,
  itemId: string,
  params: { prev_id?: string; next_id?: string },
): Promise<ListItem> {
  return apiFetch<ListItem>(`/rooms/${roomId}/lists/${listId}/items/${itemId}/position`, {
    method: 'PATCH',
    apiKey,
    body: JSON.stringify(params),
  })
}

export async function setMyPreferences(
  apiKey: string,
  preferences: { trips_show_next_stop?: boolean },
): Promise<void> {
  // 204: the caller re-reads /me.
  await apiFetch<void>('/me', { method: 'PUT', apiKey, body: JSON.stringify({ preferences }) })
}

// Web Push: the server's VAPID public key (base64url), to subscribe with.
export async function getPushKey(apiKey: string): Promise<{ publicKey: string }> {
  return apiFetch<{ publicKey: string }>('/push/key', { apiKey })
}

// Idempotent: the server upserts by endpoint (and moves it to this account if another had it).
export async function putPushSubscription(
  apiKey: string,
  body: PushSubscriptionBody,
): Promise<void> {
  await apiFetch<void>('/push/subscriptions', { method: 'PUT', apiKey, body: JSON.stringify(body) })
}

export async function deletePushSubscription(apiKey: string, endpoint: string): Promise<void> {
  await apiFetch<void>('/push/subscriptions', {
    method: 'DELETE',
    apiKey,
    body: JSON.stringify({ endpoint }),
  })
}

export async function getNotificationPrefs(apiKey: string): Promise<NotificationPrefs> {
  return apiFetch<NotificationPrefs>('/me/notifications', { apiKey })
}

export async function setNotificationPrefs(
  apiKey: string,
  prefs: NotificationPrefs,
): Promise<void> {
  await apiFetch<void>('/me/notifications', {
    method: 'PUT',
    apiKey,
    body: JSON.stringify(prefs),
  })
}

// Test accounts only (404 for anyone else).
export async function listTestActions(apiKey: string): Promise<{ actions: TestAction[] }> {
  return apiFetch<{ actions: TestAction[] }>('/test/actions', { apiKey })
}

export async function runTestAction(apiKey: string, id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/test/actions/${encodeURIComponent(id)}`, {
    method: 'POST',
    apiKey,
  })
}
