import { apiFetch, ApiError } from './client'
import type { CreateUserResponse, RoomView, User, List, ListItem } from './types'

export async function registerUser(name: string): Promise<CreateUserResponse> {
  return apiFetch<CreateUserResponse>('/users', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function registerAuth(username: string, password: string, name: string): Promise<void> {
  await apiFetch<void>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, name }),
  })
}

export async function loginAuth(username: string, password: string): Promise<{ user: User; api_key: string }> {
  return apiFetch<{ user: User; api_key: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function getMe(apiKey: string): Promise<User> {
  return apiFetch<User>('/me', { apiKey })
}

export async function updateMe(apiKey: string, name: string): Promise<User> {
  return apiFetch<User>('/me', { method: 'PUT', apiKey, body: JSON.stringify({ name }) })
}

export async function getMyRoom(apiKey: string): Promise<RoomView> {
  return apiFetch<RoomView>('/rooms/me', { apiKey })
}

export async function createRoom(apiKey: string): Promise<RoomView> {
  return apiFetch<RoomView>('/rooms', { method: 'POST', apiKey })
}

export async function rotateShare(apiKey: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/rooms/share', { method: 'POST', apiKey })
}

export async function joinRoomByToken(apiKey: string, token: string): Promise<RoomView> {
  return apiFetch<RoomView>(`/rooms/join`, { method: 'POST', apiKey, body: JSON.stringify({ token }) })
}

export async function voteDeletion(apiKey: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/rooms/deletion/vote`, { method: 'POST', apiKey })
}

export async function cancelDeletion(apiKey: string): Promise<void> {
  return apiFetch<void>(`/rooms/deletion/cancel`, { method: 'POST', apiKey })
}

export async function updateRoomSettings(apiKey: string, params: { display_name?: string; description?: string }): Promise<RoomView> {
  return apiFetch<RoomView>(`/rooms/settings`, { method: 'PUT', apiKey, body: JSON.stringify(params) })
}

export function isNotFound(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 404
}

export function isForbidden(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 403
}

export function isConflict(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 409
}

// Lists API
export async function getLists(apiKey: string, roomId: string): Promise<List[]> {
  return apiFetch<List[]>(`/rooms/${roomId}/lists`, { apiKey })
}

export async function createList(apiKey: string, roomId: string, params: { name: string; description?: string }): Promise<List> {
  return apiFetch<List>(`/rooms/${roomId}/lists`, { method: 'POST', apiKey, body: JSON.stringify(params) })
}

export async function voteListDeletion(apiKey: string, roomId: string, listId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/rooms/${roomId}/lists/${listId}/deletion/vote`, { method: 'POST', apiKey })
}

export async function cancelListDeletion(apiKey: string, roomId: string, listId: string): Promise<void> {
  return apiFetch<void>(`/rooms/${roomId}/lists/${listId}/deletion/cancel`, { method: 'POST', apiKey })
}

export async function getListItems(
  apiKey: string,
  roomId: string,
  listId: string,
  includeCompleted = false
): Promise<ListItem[]> {
  const q = includeCompleted ? '?include_completed=true' : '?include_completed=false'
  return apiFetch<ListItem[]>(`/rooms/${roomId}/lists/${listId}/items${q}`, { apiKey })
}

export async function createListItem(apiKey: string, roomId: string, listId: string, description: string): Promise<ListItem> {
  return apiFetch<ListItem>(`/rooms/${roomId}/lists/${listId}/items`, { method: 'POST', apiKey, body: JSON.stringify({ description }) })
}

export async function updateListItem(
  apiKey: string,
  roomId: string,
  listId: string,
  itemId: string,
  params: { description?: string; completed?: boolean }
): Promise<ListItem> {
  return apiFetch<ListItem>(`/rooms/${roomId}/lists/${listId}/items/${itemId}`, { method: 'PATCH', apiKey, body: JSON.stringify(params) })
}

export async function deleteListItem(apiKey: string, roomId: string, listId: string, itemId: string): Promise<void> {
  return apiFetch<void>(`/rooms/${roomId}/lists/${listId}/items/${itemId}`, { method: 'DELETE', apiKey })
}
