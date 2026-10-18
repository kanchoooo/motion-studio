import type { Brief } from './brief'
import type { Overrides } from './overrides'

export type VariationMethod = 'claude' | 'retime' | 'scale'
export type VariationStatus = 'queued' | 'working' | 'done' | 'error'

/** a variation is its own project linked to the family it came from */
export interface FamilyInfo {
  rootId: string
  parentId: string
  /** e.g. "9:16 · 6초" */
  label: string
  /** what it was made from, e.g. "현재 상태" or a version/export name */
  basedOn: string
  method: VariationMethod
  status: VariationStatus
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  appVersion: string
  agentSessionId?: string
  family?: FamilyInfo
  /** Claude model alias for this project's session (undefined = account default) */
  agentModel?: string
  /** Claude effort level (undefined = Claude Code default) */
  agentEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** 'ask' (default): Claude asks in the chat before acting outside its standing permissions; 'all': allowed */
  agentPermission?: 'ask' | 'all'
  /** made from a template: its fill-in slots are in .studio/template.json */
  template?: { id: string; name: string }
  /**
   * hand edits are open (편집 활성화 done). false: a 0.5+ project whose video is still refined in the
   * conversation (the editor only shows it); missing: an older project — always editable.
   */
  editable?: boolean
  /** came from a share file (프로젝트 공유): its Claude session starts with the handoff memo */
  sharedFrom?: { at: string; appVersion: string }
}

export interface ProjectSummary {
  id: string
  name: string
  path: string
  updatedAt: string
  ratio: string
  duration: number
  width: number
  height: number
  thumbnail?: string
  hasVideo: boolean
  family?: FamilyInfo
  /** folder inside the projects folder ("직방/숏츠"; '' = top) */
  folder: string
  template?: ProjectMeta['template']
}

export interface ProjectState {
  meta: ProjectMeta
  path: string
  brief: Brief
  overrides: Overrides
  hasVideo: boolean
}

export type HistoryActor = 'designer' | 'claude' | 'app'

export interface HistoryEntry {
  id: string
  at: string
  actor: HistoryActor
  summary: string
  /** named save point ("광고주 1차 시안") */
  versionName?: string
  starred?: boolean
  thumbnail?: string
  /** history entry this one restored */
  restoredFrom?: string
}

export interface RenderRecord {
  id: string
  file: string
  fileName: string
  createdAt: string
  historyId: string
  format: string
  width: number
  height: number
  duration: number
  bytes: number
  thumbnail?: string
  starred: boolean
  note: string
  versionName?: string
}

export interface FeedbackMark {
  id: string
  /** 1-based marker number shown on the canvas */
  n: number
  kind: 'box' | 'pin' | 'arrow' | 'pen' | 'range'
  /** composition pixel coordinates */
  rect?: { x: number; y: number; w: number; h: number }
  points?: { x: number; y: number }[]
  time: number
  range?: { from: number; to: number }
  note: string
  /** data-ms-id of elements under the mark */
  elements: { id: string; label: string }[]
  resolved: boolean
  /** images or videos for this mark (project-relative, feedback/refs/…); the note says what they are for */
  refs?: string[]
}

export interface FeedbackBatch {
  id: string
  createdAt: string
  time: number
  marks: FeedbackMark[]
  /** composition-relative snapshot paths */
  frame?: string
  annotated?: string
}
