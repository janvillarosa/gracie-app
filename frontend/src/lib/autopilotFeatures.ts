import {
  autopilotModeOf,
  type AutopilotFeature,
  type AutopilotMode,
  type RoomView,
} from '@api/types'

/** The server's feature table (autopilot.Tiers), for a server that does not send
 *  `autopilot_features` yet (the API and the app deploy separately). Goes after one release. */
const FALLBACK: Record<AutopilotMode, AutopilotFeature[]> = {
  off: [],
  suggest: ['run_hint', 'suggestions', 'up_next'],
  assist: ['auto_add', 'run_hint', 'up_next'],
}

/** Whether the House's autopilot mode includes a feature. Ask this, never compare mode strings. */
export function hasFeature(
  room: Pick<RoomView, 'autopilot_mode' | 'autopilot_features' | 'suggestions_off'>,
  feature: AutopilotFeature,
): boolean {
  return (room.autopilot_features ?? FALLBACK[autopilotModeOf(room)]).includes(feature)
}
