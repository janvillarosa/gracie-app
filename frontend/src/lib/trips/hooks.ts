import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getMyRoom } from '@api/endpoints'
import { postTripOps, syncTrips } from '@api/tripEndpoints'
import { useAuth } from '@auth/AuthProvider'
import type { TripOp } from '../../api/tripTypes'
import { getTripStore, TripStore, type StoreState } from './store'
import { usePlaceMaintenance, useEnrichedTrips } from './usePlaces'

export { flushAndDispose, getPendingOnLogout, subscribePendingOnLogout } from './store'

/** The house's trip store (one per user and house), started while the component is mounted. */
export function useTripStoreFor(
  roomId: string | undefined,
  userId: string | undefined,
  apiKey: string | null,
) {
  const qc = useQueryClient()
  const { signOut } = useAuth()
  const signOutRef = useRef(signOut)
  signOutRef.current = signOut
  // The store outlives a sign-in: it is keyed by user and house, and only the credentials
  // it talks with are swapped (never captured), so a new key is used from the next call on.
  const api = useMemo(
    () =>
      apiKey
        ? {
            sync: (room: string, known: Record<string, number>) => syncTrips(apiKey, room, known),
            ops: (room: string, ops: TripOp[]) => postTripOps(apiKey, room, ops),
          }
        : null,
    [apiKey],
  )
  const apiRef = useRef(api)
  apiRef.current = api
  const store = useMemo(() => {
    if (!roomId || !userId || !apiRef.current) return null
    return getTripStore(
      `${userId}:${roomId}`,
      () =>
        new TripStore({
          roomId,
          userId,
          api: apiRef.current as NonNullable<typeof api>,
          // After joining another house the old room answers 403: re-read who we are, and
          // the store for the new house loads the whole saved outbox (it is per user, not per house)
          // and re-tags it, so ops queued before the join still go out.
          onForbidden: () => {
            void qc.invalidateQueries({ queryKey: ['me'] })
            void qc.invalidateQueries({ queryKey: ['my-room'] })
          },
          // A key that is no longer accepted is not "offline": sign out through the same path as
          // everything else (back to the login), keeping the queued changes on the device.
          onUnauthorized: () => {
            void signOutRef.current?.('expired')
          },
        }),
    )
  }, [roomId, userId, qc, !!apiKey])
  useEffect(() => {
    if (store && api) store.setApi(api)
  }, [store, api])
  useEffect(() => {
    if (!store) return
    store.start()
    return () => store.stop()
  }, [store])
  return store
}

const EMPTY: StoreState = {
  ready: false,
  synced: false,
  trips: {},
  pending: 0,
  offline: false,
  notes: {},
  toasts: [],
  persistFailed: false,
}
const noop = () => () => {}

export function useTripState(store: TripStore | null): StoreState {
  return useSyncExternalStore(
    store ? store.subscribe : noop,
    store ? store.getState : () => EMPTY,
    () => EMPTY,
  )
}

export type Member = { user_id?: string; name: string; avatar_key?: string }

/** Everything a trips screen needs: the store, its state, who I am and the house members. */
export function useTrips() {
  const { apiKey } = useAuth()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(apiKey as string),
    enabled: !!apiKey,
  })
  const room = useQuery({
    queryKey: ['my-room'],
    queryFn: () => getMyRoom(apiKey as string),
    enabled: !!apiKey,
    retry: false,
  })
  const store = useTripStoreFor(me.data?.room_id ?? undefined, me.data?.user_id, apiKey)
  const raw = useTripState(store)
  // Google places get their name and address from the session cache, for display only.
  const trips = useEnrichedTrips(raw.trips)
  const state = useMemo(() => (trips === raw.trips ? raw : { ...raw, trips }), [raw, trips])
  usePlaceMaintenance(store, raw.trips, raw.offline)
  const members: Member[] = useMemo(
    () =>
      room.data?.members_meta?.map((m) => ({
        user_id: m.user_id,
        name: m.name,
        avatar_key: m.avatar_key,
      })) ?? [],
    [room.data],
  )
  return {
    store,
    state,
    userId: me.data?.user_id,
    roomName: room.data?.display_name || 'House',
    // Account preference, on by default.
    showNextStop: me.data?.preferences?.trips_show_next_stop !== false,
    members,
    loading: me.isLoading || room.isLoading || !state.ready,
  }
}

/** "Mia" for a user id. Falls back gracefully while the room view has no ids. */
export function memberName(userId: string | undefined, me: string | undefined, members: Member[]) {
  if (!userId) return ''
  if (userId === me) return 'you'
  return members.find((m) => m.user_id === userId)?.name ?? 'a housemate'
}
