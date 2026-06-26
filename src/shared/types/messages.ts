import type { PlaylistDurationResult } from './playlist'

export type Message =
  | { type: 'PLAYLIST_DURATIONS_UPDATED'; payload: PlaylistDurationResult }
  | { type: 'GET_PLAYLIST_DURATION'; payload?: { playlistId?: string } }
  | { type: 'GET_NATIVE_CHAPTERS' }
  | { type: 'GENERATE_CHAPTERS'; payload: { videoId: string; title: string; durationSeconds: number } }
  | { type: 'CHAPTER_PROGRESS'; payload: { videoId: string; progress: number; label: string } }
  | { type: 'SEEK_TO'; payload: { seconds: number } }
  | { type: 'VIDEO_CONTEXT'; payload: { videoId: string; title: string; durationSeconds: number } }
  | { type: 'GET_VIDEO_CONTEXT' }
  | { type: 'INVALIDATE_CHAPTER_CACHE'; payload: { videoId: string } }

export type MessageType = Message['type']

export type MessagePayload<T extends MessageType> = Extract<
  Message,
  { type: T }
> extends { payload: infer P }
  ? P
  : never
