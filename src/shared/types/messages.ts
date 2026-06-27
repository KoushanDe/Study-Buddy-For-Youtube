import type { PlaylistDurationResult } from './playlist'
import type { VideoContext } from './video'

export type { VideoContext }

export type Message =
  | { type: 'PLAYLIST_DURATIONS_UPDATED'; payload: PlaylistDurationResult }
  | { type: 'GET_PLAYLIST_DURATION'; payload?: { playlistId?: string } }
  | { type: 'GET_NATIVE_CHAPTERS'; payload: { videoId: string } }
  | { type: 'FETCH_TRANSCRIPT'; payload: { videoId: string } }
  | { type: 'GENERATE_CHAPTERS'; payload: { videoId: string; title: string; durationSeconds: number } }
  | { type: 'GET_CHAPTER_JOB_STATUS'; payload: { videoId: string } }
  | { type: 'GET_CHAPTER_CACHE'; payload: { videoId: string } }
  | { type: 'GET_REGENERATE_QUOTA' }
  | { type: 'CHAPTER_PROGRESS'; payload: { videoId: string; progress: number; label: string } }
  | { type: 'SEEK_TO'; payload: { seconds: number } }
  | { type: 'VIDEO_CONTEXT'; payload: VideoContext }
  | { type: 'GET_VIDEO_CONTEXT' }
  | { type: 'REGENERATE_CHAPTERS'; payload: { videoId: string } }
