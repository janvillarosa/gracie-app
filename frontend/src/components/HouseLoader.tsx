import React from 'react'
import { HouseMark } from '@components/HouseMark'

// Page-level loading: the logo builds itself (roof, walls, room, window, light, door),
// holds, and starts over. It stays invisible for its first moments so a fast response
// never flashes it.
export const HouseLoader: React.FC<{ label: string; size?: number }> = ({ label, size = 64 }) => (
  <span className="house-loader" role="status" aria-label={label}>
    <HouseMark size={size} />
  </span>
)
