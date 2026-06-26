import { SPEEDS } from '../../shared/constants'
import { formatDuration } from '../../shared/utils/format-duration'
import type { SpeedDuration } from '../../shared/types/playlist'

export function calculateSpeedDurations(totalSeconds: number): SpeedDuration[] {
  return SPEEDS.map((speed) => {
    const adjusted = totalSeconds / speed
    return {
      speed,
      label: speed === 1 ? '1x' : `${speed}x`,
      formatted: formatDuration(adjusted),
      totalSeconds: adjusted,
    }
  })
}
