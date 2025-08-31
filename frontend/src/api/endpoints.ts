import { apiFetch, ApiError } from './client'
import type { CreateUserResponse, Room, User } from './types'

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

export async function getMyRoom(apiKey: string): Promise<Room> {
  return apiFetch<Room>('/rooms/me', { apiKey })
}

export async function createRoom(apiKey: string): Promise<Room> {
  return apiFetch<Room>('/rooms', { method: 'POST', apiKey })
}

export async function rotateShare(apiKey: string): Promise<{ room_id: string; token: string }> {
  return apiFetch<{ room_id: string; token: string }>('/rooms/share', { method: 'POST', apiKey })
}

export async function joinRoom(apiKey: string, roomId: string, token: string): Promise<Room> {
  return apiFetch<Room>(`/rooms/${encodeURIComponent(roomId)}/join`, {
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

export function isNotFound(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 404
}

export function isForbidden(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 403
}

export function isConflict(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).status === 409
}
