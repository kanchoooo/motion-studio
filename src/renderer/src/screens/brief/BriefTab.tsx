// 브리프 = planning with Claude in conversation. On the left: the output spec (the one thing
// to set), the storyboard Claude showed (assign materials to it) and the material library
// (import, generate with AI and the prompt helper); a storyboard or library panel opens between
// that menu and the chat. The chat is the same conversation the editor shows: when the designer
// approves in it ("제작해줘"), Claude starts building and the editor opens (start_build).
import { ChevronRight, Film, Image, Monitor } from 'lucide-react'
import { FPS_OPTIONS, OUTPUT_PRESETS } from '@shared/brief'
import { useStore } from '../../store'
import { ChatPanel } from '../editor/ChatPanel'
import { AssetsPanel } from './AssetsPanel'
import { useBriefUi, type BriefPanel } from './briefUi'
import { OutputPopup } from './OutputPopup'
import { StoryboardPanel } from './StoryboardPanel'

export function BriefTab() {
  const { project, storyboard, setTab } = useStore()
  const { panel, open } = useBriefUi()
  const o = project!.brief.output
  const preset = OUTPUT_PRESETS.find((p) => p.id === o.preset)
  const fps = `${FPS_OPTIONS.find((f) => Math.abs(f.value - o.fps) < 0.01)?.label ?? o.fps}fps`
  const scenes = storyboard?.storyboard.scenes ?? []
  const slots = scenes.flatMap((s) => s.materials ?? [])
  const empty = slots.filter((m) => !m.file).length

  const item = (id: BriefPanel, icon: React.ReactNode, label: string, sub: string, badge?: string) => (
    <button key={id} className={`brief-nav${panel === id ? ' on' : ''}`} onClick={() => open(id)} data-testid={`brief-nav-${id}`}>
      {icon}
      <span className="col grow" style={{ gap: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="tiny muted ellipsis">{sub}</span>
      </span>
      {badge && <span className="badge">{badge}</span>}
      <ChevronRight size={14} color="var(--text-3)" />
    </button>
  )

  return (
    <div style={{ height: '100%', display: 'flex', minWidth: 0 }} data-testid="brief-tab">
      <nav style={{ width: 236, borderRight: '1px solid var(--border)', padding: 12, flex: 'none', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
        <div className="section-label" style={{ padding: '6px 10px' }}>브리프</div>
        {item('output', <Monitor size={15} />, '출력 사양', `${preset ? preset.ratio : `${o.width}×${o.height}`} · ${o.duration}초 · ${fps}`)}
        {item('storyboard', <Film size={15} />, '스토리보드', scenes.length ? `장면 ${scenes.length}개${slots.length ? ` · 소재 ${slots.length - empty}/${slots.length}` : ''}` : '대화에서 콘티를 만들면 여기에 모여요', storyboard?.status === 'approved' ? '승인' : undefined)}
        {item('assets', <Image size={15} />, '소재', project!.brief.assets.length ? `${project!.brief.assets.length}개 · 가져오기·AI로 만들기` : '가져오기 · AI로 만들기')}
        <div className="grow" />
        <div className="tiny muted" style={{ padding: '0 6px 8px', lineHeight: 1.6 }}>
          기획은 대화로 해요. 레퍼런스 영상·이미지·유튜브 주소를 대화에 바로 넣을 수 있어요. 기획이 정해지면 "제작해줘"라고 말하면 만들기 시작해요.
        </div>
        {project!.hasVideo && (
          <button className="btn ghost sm" onClick={() => setTab('editor')}>
            편집으로 가기
          </button>
        )}
        {panel === 'output' && <OutputPopup onClose={() => open(null)} />}
      </nav>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', background: 'var(--bg)' }}>
        {(panel === 'storyboard' || panel === 'assets') && (
          <div className="floating-panel left fade-in" style={{ width: panel === 'assets' ? 'min(1040px, 66%)' : 'min(820px, 56%)' }} data-testid={`brief-panel-${panel}`}>
            {panel === 'storyboard' ? <StoryboardPanel onClose={() => open(null)} /> : <AssetsPanel onClose={() => open(null)} />}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 380, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 880, height: '100%' }} data-testid="plan-chat">
            <ChatPanel mode="plan" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="col" style={{ gap: 4, marginBottom: 20 }}>
      <div className="h2">{title}</div>
      <div className="muted">{desc}</div>
    </div>
  )
}
