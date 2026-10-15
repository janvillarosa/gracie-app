import { apiFetch } from './client'
import type { List } from './types'
import type { OpsResponse, PlacesResponse, SyncResponse, TripOp } from './tripTypes'

export async function syncTrips(
  apiKey: string,
  roomId: string,
  known: Record<string, number>,
): Promise<SyncResponse> {
  return apiFetch<SyncResponse>(`/rooms/${roomId}/trips/sync`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify({ known }),
  })
}

export async function postTripOps(
  apiKey: string,
  roomId: string,
  ops: TripOp[],
): Promise<OpsResponse> {
  return apiFetch<OpsResponse>(`/rooms/${roomId}/trips/ops`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify({ ops }),
  })
}

export async function createPackingList(
  apiKey: string,
  roomId: string,
  tripId: string,
): Promise<List> {
  return apiFetch<List>(`/rooms/${roomId}/trips/${tripId}/packing-list`, {
    method: 'POST',
    apiKey,
  })
}

export async function searchPlaces(
  apiKey: string,
  params: { q: string; lat?: number; lng?: number; lang?: string; limit?: number },
): Promise<PlacesResponse> {
  const qs = new URLSearchParams({ q: params.q })
  // Bias coordinates are rounded to one decimal for privacy (the server does the same).
  if (params.lat !== undefined) qs.set('lat', params.lat.toFixed(1))
  if (params.lng !== undefined) qs.set('lng', params.lng.toFixed(1))
  if (params.lang) qs.set('lang', params.lang)
  if (params.limit) qs.set('limit', String(params.limit))
  return apiFetch<PlacesResponse>(`/places/search?${qs}`, { apiKey })
}

export async function reversePlace(
  apiKey: string,
  lat: number,
  lng: number,
): Promise<PlacesResponse> {
  return apiFetch<PlacesResponse>(`/places/reverse?lat=${lat}&lng=${lng}`, { apiKey })
}
