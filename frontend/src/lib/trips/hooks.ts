import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getMyRoom } from '@api/endpoints'
import { postTripOps, syncTrips } from '@api/tripEndpoints'
import { useAuth } from '@auth/AuthProvider'
import { getTripStore, TripStore, type StoreState } from './store'

/** The house's trip store (one per user and house), started while the component is mounted. */
export function useTripStoreFor(
  roomId: string | undefined,
  userId: string | undefined,
  apiKey: string | null,
) {
  const qc = useQueryClient()
  const store = useMemo(() => {
    if (!roomId || !userId || !apiKey) return null
    return getTripStore(
      `${userId}:${roomId}`,
      () =>
        new TripStore({
          roomId,
          userId,
          api: {
            sync: (room, known) => syncTrips(apiKey, room, known),
            ops: (room, ops) => postTripOps(apiKey, room, ops),
          },
          // After joining another house the old room answers 403: re-read who we are, and
          // the store for the new house picks the saved outbox up.
          onForbidden: () => {
            void qc.invalidateQueries({ queryKey: ['me'] })
            void qc.invalidateQueries({ queryKey: ['my-room'] })
          },
        }),
    )
  }, [roomId, userId, apiKey, qc])
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
  const state = useTripState(store)
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
