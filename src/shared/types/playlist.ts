import type { SPEEDS } from '../constants'

export type PlaybackSpeed = (typeof SPEEDS)[number]

export interface SpeedDuration {
  speed: PlaybackSpeed
  label: string
  formatted: string
  totalSeconds: number
}

export interface PlaylistDurationResult {
  playlistId: string
  title: string | null
  owner: string | null
  loadedCount: number
  totalCount: number | null
  hiddenCount: number | null
  availableCount: number | null
  totalSeconds: number
  speeds: SpeedDuration[]
  isScanning: boolean
  updatedAt: number
}
