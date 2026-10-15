import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import type { Trip } from '@api/tripTypes'
import { createPackingList } from '@api/tripEndpoints'
import { errorMessage } from '@lib/errors'
import { diffDays } from '@lib/trips/schedule'
import type { TripStore } from '@lib/trips/store'
import { usePacking } from '@lib/trips/usePacking'

type Args = {
  trip: Trip
  store: TripStore
  apiKey: string | null
  online: boolean
  phase: string
  today: string
}

/** The packing list is the List page's: the menu says how packed it is and goes straight there;
 *  within three days of leaving, with things still to pack, Plan shows one quiet line. */
export function usePackingLine({ trip, store, apiKey, online, phase, today }: Args) {
  const navigate = useNavigate()
  const [packBusy, setPackBusy] = useState(false)
  const packing = usePacking(store.roomId, trip.packing_list_id)
  const toList = (listId: string) =>
    navigate(`/app/lists/${listId}`, {
      state: { from: `trip:${trip.trip_id}`, fromLabel: trip.title },
    })
  const onPacking = async () => {
    if (packing.listId) return toList(packing.listId)
    if (!online || packBusy) return
    setPackBusy(true)
    try {
      const made = await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
      toList(made.list_id)
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t make the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }
  const packingMenu = packing.listId
    ? { label: `Packing list${packing.text ? ` · ${packing.text}` : ''}`, disabled: false }
    : online
      ? { label: 'Make a packing list', disabled: packBusy }
      : { label: 'Connect to make one', disabled: true }
  // Within three days of leaving, with things still to pack: one quiet line at the top of Plan.
  const toPack =
    phase === 'before' &&
    !!trip.start_date &&
    diffDays(trip.start_date, today) <= 3 &&
    packing.listId &&
    packing.total !== undefined &&
    packing.packed !== undefined &&
    packing.total > 0 &&
    packing.packed < packing.total

  return { packing, toList, onPacking, packingMenu, toPack }
}
