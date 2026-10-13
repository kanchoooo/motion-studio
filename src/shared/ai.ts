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
  /** sign-in page (to copy into any browser's private window) */
  url?: string
  /** the page could not be opened as asked (e.g. Safari has no private window
   *  from outside): its address was copied for the designer to paste */
  copied?: boolean
}

/** an installed web browser the sign-in page can be opened in */
export interface LoginBrowser {
  id: string
  /** e.g. "Chrome" */
  name: string
  /** e.g. "시크릿 창" */
  privateName: string
  /** false: the app cannot open its private window (Safari): the address is copied instead */
  canPrivate: boolean
}

/** how the sign-in page opens: a private window does not reuse the account
 *  the browser is signed in with (often the company one), a normal one does */
export interface LoginWindow {
  mode: 'private' | 'normal'
  /** a LoginBrowser id, or 'default' (normal: the system's default browser) */
  browser: string
}

export type AiMediaKind = 'image' | 'video' | 'audio'

export interface AiModelInfo {
  provider: AiConnectProvider
  id: string
  name: string
  kind: AiMediaKind
  description?: string
  /** the service recommends it (shown first) */
  recommended?: boolean
  /** needs a paid plan on the service */
  premium?: boolean
  /** exists, but the signed-in account's plan cannot use it */
  unavailable?: boolean
}

export interface AiModelList {
  items: AiModelInfo[]
  /** shown under the picker, e.g. "영상 생성은 프리미엄 플랜이 필요해요" */
  note?: string
}

export interface AiVoiceInfo {
  provider: AiConnectProvider
  id: string
  name: string
  /** service's own description (often English) */
  description?: string
  /** e.g. ["Korean"] */
  languages?: string[]
  /** speaks any language (e.g. Google voices on Magnific) */
  multilingual?: boolean
  gender?: 'female' | 'male' | 'neutral' | string
  age?: 'young' | 'middle_aged' | 'old' | string
  /** sample audio the designer can play for free */
  previewUrl?: string
  thumbnail?: string
  /** Higgsfield needs voice_type with the id (preset | element) */
  voiceType?: string
  /** Magnific: catalog | mine (cloned voices share ids with the catalog) */
  source?: string
  /** engine behind the voice (elevenlabs, google…) */
  engine?: string
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
