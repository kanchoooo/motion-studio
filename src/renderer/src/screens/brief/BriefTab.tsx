import { useEffect, useRef, useState } from 'react'
import { Check, Clapperboard, FileText, Film, Image, Loader2, Monitor, Palette, Sparkles } from 'lucide-react'
import type { Brief } from '@shared/brief'
import { studio, useStore } from '../../store'
import { AiSection } from './AiSection'
import { AssetsSection } from './AssetsSection'
import { OutputSection } from './OutputSection'
import { ReferencesSection } from './ReferencesSection'
import { StoryboardSection } from './StoryboardSection'
import { TextsSection } from './TextsSection'
import { ToneSection } from './ToneSection'

const SECTIONS = [
  { id: 'output', label: '출력 사양', icon: Monitor },
  { id: 'texts', label: '필수 문구', icon: FileText },
  { id: 'assets', label: '소재', icon: Image },
  { id: 'references', label: '레퍼런스', icon: Clapperboard },
  { id: 'tone', label: '톤앤매너·메모', icon: Palette },
  { id: 'storyboard', label: '스토리보드', icon: Film },
  { id: 'ai', label: 'AI 생성·음성', icon: Sparkles },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function BriefTab() {
  const { project, setProject, toast, setTab } = useStore()
  const [brief, setBrief] = useState<Brief>(project!.brief)
  const [section, setSection] = useState<SectionId>('output')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pid = project!.meta.id

  useEffect(() => setBrief(project!.brief), [project?.meta.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Brief) => {
    setBrief(next)
    setSaving('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        setProject(await studio.projects.saveBrief(pid, next))
        setSaving('saved')
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        setSaving('idle')
      }
    }, 700)
  }

  const counts: Partial<Record<SectionId, number>> = { texts: brief.texts.length, assets: brief.assets.length, storyboard: brief.storyboard.length }

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <nav style={{ width: 220, borderRight: '1px solid var(--border)', padding: 12, flex: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="section-label" style={{ padding: '6px 10px' }}>브리프</div>
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const on = s.id === section
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className="row"
              style={{
                height: 34,
                padding: '0 10px',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text)',
                fontWeight: on ? 650 : 500,
              }}
            >
              <Icon size={15} />
              <span className="grow" style={{ textAlign: 'left' }}>{s.label}</span>
              {counts[s.id] ? <span className="badge">{counts[s.id]}</span> : null}
            </button>
          )
        })}
        <div className="grow" />
        <div className="row small muted" style={{ padding: '8px 10px' }}>
          {saving === 'saving' ? <Loader2 size={13} className="spin" /> : saving === 'saved' ? <Check size={13} color="var(--success)" /> : null}
          {saving === 'saving' ? '저장 중…' : saving === 'saved' ? '자동 저장됨' : '변경하면 자동 저장돼요'}
        </div>
        <button className="btn primary" onClick={() => setTab('editor')}>
          편집으로 가기
        </button>
      </nav>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 32px 80px' }}>
          {section === 'output' && <OutputSection brief={brief} onChange={update} />}
          {section === 'texts' && <TextsSection brief={brief} onChange={update} />}
          {section === 'assets' && <AssetsSection brief={brief} onChange={update} />}
          {section === 'references' && <ReferencesSection />}
          {section === 'tone' && <ToneSection brief={brief} onChange={update} />}
          {section === 'storyboard' && <StoryboardSection brief={brief} onChange={update} />}
          {section === 'ai' && <AiSection brief={brief} onChange={update} />}
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
