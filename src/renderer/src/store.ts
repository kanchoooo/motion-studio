import { create } from 'zustand'
import type { AudioCandidateList } from '@shared/ai'
import type { AgentEvent, ChatItem, DoctorReport, ExportProgress, FontFamily, SessionState } from '@shared/api'
import type { ProjectState, ProjectSummary } from '@shared/project'

export const studio = window.studio

export type Screen = 'update' | 'lock' | 'doctor' | 'home' | 'project'
export type ProjectTab = 'brief' | 'editor' | 'results'

interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface State {
  screen: Screen
  theme: 'dark' | 'light'
  doctor: DoctorReport | null
  projects: ProjectSummary[]
  project: ProjectState | null
  tab: ProjectTab
  chat: ChatItem[]
  session: SessionState
  terminalOpen: boolean
  loginOpen: boolean
  previewNonce: number
  historyNonce: number
  familyNonce: number
  exportProgress: ExportProgress | null
  fonts: FontFamily[]
  toasts: Toast[]
  /** latest music / sound candidates Claude found for the open project */
  audioCandidates: AudioCandidateList | null
  aiOpen: boolean

  go(screen: Screen): void
  setTab(tab: ProjectTab): void
  setTheme(t: 'dark' | 'light'): void
  refreshProjects(): Promise<void>
  openProject(path: string): Promise<void>
  setProject(p: ProjectState): void
  closeProject(): void
  toast(text: string, kind?: Toast['kind']): void
  setTerminal(open: boolean): void
  loadFonts(): Promise<void>
}

let toastSeq = 0

export const useStore = create<State>((set, get) => ({
  screen: 'update',
  theme: (localStorage.getItem('ms-theme') as 'dark' | 'light') || 'dark',
  doctor: null,
  projects: [],
  project: null,
  tab: 'brief',
  chat: [],
  session: { status: 'stopped' },
  terminalOpen: false,
  loginOpen: false,
  previewNonce: 0,
  historyNonce: 0,
  familyNonce: 0,
  exportProgress: null,
  fonts: [],
  toasts: [],
  audioCandidates: null,
  aiOpen: false,

  go: (screen) => set({ screen }),
  setTab: (tab) => set({ tab }),
  setTheme: (theme) => {
    localStorage.setItem('ms-theme', theme)
    document.documentElement.dataset.theme = theme
    void studio.app.setTheme(theme)
    set({ theme })
  },
  refreshProjects: async () => set({ projects: await studio.projects.list() }),
  openProject: async (path) => {
    const project = await studio.projects.open(path)
    const id = project.meta.id
    set({ project, screen: 'project', tab: project.hasVideo ? 'editor' : 'brief', chat: [], session: { status: 'starting' }, exportProgress: null, audioCandidates: null })
    const session = await studio.agent.start(id)
    const chat = await studio.agent.transcript(id)
    if (get().project?.meta.id === id) set({ session, chat, terminalOpen: session.attention === 'trust' || get().terminalOpen })
  },
  setProject: (project) => set({ project }),
  closeProject: () => {
    set({ project: null, screen: 'home', chat: [] })
    void get().refreshProjects()
  },
  toast: (text, kind = 'info') => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500)
  },
  setTerminal: (terminalOpen) => set({ terminalOpen }),
  loadFonts: async () => {
    if (!get().fonts.length) set({ fonts: await studio.fonts.list() })
  },
}))

// ---- live events from the main process -----------------------------------------

studio.agent.onEvent((e: AgentEvent) => {
  const s = useStore.getState()
  if (e.type === 'family-changed') {
    useStore.setState({ familyNonce: s.familyNonce + 1 })
    return
  }
  const pid = s.project?.meta.id
  if (!('projectId' in e) || e.projectId !== pid) return
  switch (e.type) {
    case 'session': {
      const opened = (e.state.attention === 'trust' || e.state.attention === 'login') && s.session.attention !== e.state.attention
      useStore.setState({ session: e.state, terminalOpen: opened ? true : s.terminalOpen })
      break
    }
    case 'item':
      if (!s.chat.some((c) => c.id === e.item.id)) useStore.setState({ chat: [...s.chat, e.item] })
      break
    case 'item-update':
      useStore.setState({ chat: s.chat.map((c) => (c.id === e.item.id ? e.item : c)) })
      break
    case 'composition-changed':
      useStore.setState({ previewNonce: s.previewNonce + 1 })
      void studio.projects.state(pid!).then((p) => useStore.getState().project?.meta.id === p.meta.id && useStore.setState({ project: p }))
      break
    case 'history-changed':
      useStore.setState({ historyNonce: s.historyNonce + 1 })
      break
    case 'audio-candidates':
      useStore.setState({ audioCandidates: e.list })
      useStore.getState().toast(`음악 후보 ${e.list.items.length}개를 찾았어요. 사운드 패널에서 들어 보세요.`, 'success')
      break
  }
})

studio.renders.onProgress((p) => {
  const s = useStore.getState()
  if (p.projectId !== s.project?.meta.id) return
  useStore.setState({ exportProgress: p })
  if (p.phase === 'done') useStore.setState({ historyNonce: s.historyNonce + 1 })
})

document.documentElement.dataset.theme = useStore.getState().theme
