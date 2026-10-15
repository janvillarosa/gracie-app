import { apiFetch } from './client'
import type { List } from './types'
import type { OpsResponse, SyncResponse, TripOp } from './tripTypes'

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
