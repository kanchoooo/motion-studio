// AI services: Higgsfield and Magnific (image / video / TTS, the app is the MCP
// client) and Artlist (music / sound, Claude Code is the MCP client).
import type { AiProviderId } from './brief'

/** services the app signs in to itself */
export type AiConnectProvider = 'higgsfield' | 'magnific'

export interface AiProviderMeta {
  id: AiProviderId
  name: string
  url: string
  /** app = the app holds the OAuth session; claude = Claude Code signs in (/mcp) */
  client: 'app' | 'claude'
  can: ('image' | 'video' | 'tts' | 'music' | 'sfx')[]
  site: string
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  higgsfield: { id: 'higgsfield', name: '힉스필드', url: 'https://mcp.higgsfield.ai/mcp', client: 'app', can: ['image', 'video', 'tts'], site: 'https://higgsfield.ai' },
  magnific: { id: 'magnific', name: '매그니픽', url: 'https://mcp.magnific.com', client: 'app', can: ['image', 'video', 'tts'], site: 'https://www.magnific.com' },
  artlist: { id: 'artlist', name: '아트리스트', url: 'https://mcp.artlist.io/mcp', client: 'claude', can: ['music', 'sfx', 'tts'], site: 'https://artlist.io' },
}

export interface AiAccountInfo {
  id: string
  provider: AiConnectProvider
  label: string
  email?: string
  name?: string
  createdAt: string
  active: boolean
  needsLogin: boolean
}

export interface AiLoginEvent {
  provider: AiConnectProvider
  status: 'waiting' | 'done' | 'error' | 'cancelled'
  message?: string
  account?: AiAccountInfo
}

export type AiMediaKind = 'image' | 'video' | 'audio'

export interface AiModelInfo {
  provider: AiConnectProvider
  id: string
  name: string
  kind: AiMediaKind
  description?: string
}

export interface AiVoiceInfo {
  provider: AiConnectProvider
  id: string
  name: string
  description?: string
  language?: string
  gender?: string
  tags?: string[]
  /** sample audio the designer can play */
  previewUrl?: string
}

/** music / sound found by Claude (e.g. on Artlist) for the designer to audition */
export interface AudioCandidate {
  id: string
  source: string
  kind: 'bgm' | 'sfx'
  title: string
  artist?: string
  duration?: number
  bpm?: number
  mood?: string
  previewUrl?: string
  /** downloadable file when the service offers one */
  downloadUrl?: string
  pageUrl?: string
}

export interface AudioCandidateList {
  id: string
  at: string
  query: string
  kind: 'bgm' | 'sfx'
  items: AudioCandidate[]
}

export interface AiSettings {
  /** add Artlist to Claude sessions (sign-in happens in the Claude terminal) */
  artlist: boolean
}
