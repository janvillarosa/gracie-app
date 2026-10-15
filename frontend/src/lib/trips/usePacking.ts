import { useQuery } from '@tanstack/react-query'
import { getListItems, getLists } from '@api/endpoints'
import { useAuth } from '@auth/AuthProvider'

/** A trip's packing list as the List page knows it: is it linked (and still there), and how
 *  much of it is packed. A missing or deleted list counts as unlinked. */
export function usePacking(roomId: string | undefined, packingListId?: string | null) {
  const { apiKey } = useAuth()
  const lists = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey as string, roomId as string),
    enabled: !!roomId && !!apiKey,
  })
  const linked = packingListId
    ? lists.data?.find((l) => l.list_id === packingListId && !l.is_deleted)
    : undefined
  const items = useQuery({
    queryKey: ['list-items', linked?.list_id, 'all'],
    queryFn: () =>
      getListItems(apiKey as string, roomId as string, linked?.list_id as string, true),
    enabled: !!linked && !!roomId && !!apiKey,
  })
  const total = items.data?.length
  const packed = items.data?.filter((i) => i.completed).length
  return {
    listId: linked?.list_id,
    total,
    packed,
    refresh: () => lists.refetch(),
    /** "4 of 12 packed", "Empty", or "" while it loads. */
    text:
      total === undefined || packed === undefined
        ? ''
        : total === 0
          ? 'Empty · add items'
          : `${packed} of ${total} packed`,
  }
}
