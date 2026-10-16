import React from 'react'
import { CircleDashed } from '@phosphor-icons/react'
import type { ListIcon } from '@api/types'
import { ChipGroup } from '@components/ui'
import { LIST_ICONS, ICON_EMOJI } from '../icons'

const NONE = 'NONE'
const label = (key: string) =>
  key === 'TV' ? 'TV' : key.charAt(0) + key.slice(1).toLowerCase().replace('_', ' ')

type Props = {
  value?: ListIcon
  onChange: (value?: ListIcon) => void
}

/** A list's icon as choice tiles, "None" first: the same tiles as the trip icon picker. */
export const IconPicker: React.FC<Props> = ({ value, onChange }) => (
  <ChipGroup<ListIcon | typeof NONE>
    label="List icon"
    value={value ?? NONE}
    columns={3}
    options={[
      { value: NONE, label: 'None', icon: <CircleDashed weight="bold" /> },
      ...LIST_ICONS.map((ic) => ({ value: ic, label: label(ic), icon: ICON_EMOJI[ic] })),
    ]}
    onChange={(v) => onChange(v === NONE ? undefined : v)}
  />
)

export default IconPicker
