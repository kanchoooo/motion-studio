import { useState } from 'react'
import { ArrowLeft, Copy, Download, LayoutTemplate, Radio, Sparkles, SquareTerminal } from 'lucide-react'
import { ConnectionsModal } from '../components/ai/ConnectionsModal'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { studio, useStore, type ProjectTab } from '../store'
import { BriefTab } from './brief/BriefTab'
import { EditorTab } from './editor/EditorTab'
import { ExportModal } from './ExportModal'
import { ResultsTab } from './history/ResultsTab'
import { FamilyMenu } from './variations/FamilyMenu'
import { VariationModal } from './variations/VariationModal'
import { TemplateCreateModal } from './templates/TemplateCreateModal'
import { TemplateSlotsModal } from './templates/TemplateSlotsModal'

const TABS: { id: ProjectTab; label: string }[] = [
  { id: 'brief', label: '브리프' },
  { id: 'editor', label: '편집' },
  { id: 'results', label: '결과물' },
]

export function Project() {
  const { project, tab, setTab, closeProject, session, terminalOpen, setTerminal, exportProgress, aiOpen } = useStore()
  const [exporting, setExporting] = useState(false)
  const [varying, setVarying] = useState(false)
  const [templating, setTemplating] = useState(false)
  const [slots, setSlots] = useState(false)
  if (!project) return null

  const status = {
    stopped: { label: 'Claude 꺼짐', cls: '' },
    starting: { label: 'Claude 연결 중', cls: 'warning' },
    ready: { label: 'Claude 대기 중', cls: 'success' },
    busy: { label: 'Claude 작업 중', cls: 'accent' },
    exited: { label: 'Claude 종료됨', cls: 'danger' },
  }[session.status]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="row drag" style={{ height: 'var(--titlebar)', padding: '0 12px 0 88px', borderBottom: '1px solid var(--border)', flex: 'none', gap: 12 }}>
        <button className="icon-btn no-drag" title="홈으로" onClick={closeProject}>
          <ArrowLeft size={16} />
        </button>
        <FamilyMenu onCreate={() => setVarying(true)} onTemplate={() => setTemplating(true)} />
        <div className="seg no-drag" style={{ marginLeft: 8 }}>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="row no-drag" style={{ gap: 6 }}>
          <span className={`badge ${status.cls}`} title={session.sessionId ? `세션 ${session.sessionId}` : undefined}>
            <span className="dot" />
            {status.label}
          </span>
          {session.remoteUrl && (
            <button
              className="btn ghost sm"
              title="휴대폰이나 claude.ai에서 같은 대화를 이어갈 수 있어요"
              onClick={() => studio.app.openExternal(session.remoteUrl!)}
            >
              <Radio size={13} color="var(--success)" />
              리모트 컨트롤
            </button>
          )}
          <button className="btn ghost sm" title="힉스필드·매그니픽·아트리스트 연결, 회사/개인 계정 전환" onClick={() => useStore.setState({ aiOpen: true })} data-testid="ai-connections">
            <Sparkles size={13} />
            AI 연결
          </button>
          <button className={`icon-btn${terminalOpen ? ' active' : ''}`} title="터미널 열기/닫기" onClick={() => setTerminal(!terminalOpen)}>
            <SquareTerminal size={16} />
          </button>
          <ThemeSwitch />
          {project.meta.template && (
            <button className="btn sm" onClick={() => setSlots(true)} title={`템플릿 "${project.meta.template.name}"의 글자·이미지·내레이션 바꾸기`} data-testid="template-slots-open">
              <LayoutTemplate size={14} />
              템플릿 칸
            </button>
          )}
          <button className="btn sm" disabled={!project.hasVideo} onClick={() => setVarying(true)} title="다른 크기·길이 버전 만들기">
            <Copy size={14} />
            베리에이션
          </button>
          <button className="btn primary sm" disabled={!project.hasVideo} onClick={() => setExporting(true)} title={project.hasVideo ? '' : '영상을 먼저 만들어 주세요'}>
            <Download size={14} />
            {exportProgress && !['done', 'error', 'cancelled'].includes(exportProgress.phase) ? `${Math.round(exportProgress.percent)}%` : '내보내기'}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'clip' }}>
        {tab === 'brief' && <BriefTab />}
        {/* the editor stays mounted so the player and terminal keep their state */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'editor' ? 'visible' : 'hidden' }}>
          <EditorTab active={tab === 'editor'} />
        </div>
        {tab === 'results' && <ResultsTab />}
      </div>
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
      {varying && <VariationModal onClose={() => setVarying(false)} />}
      {templating && <TemplateCreateModal folder="" sourcePath={project.path} onClose={() => setTemplating(false)} />}
      {slots && <TemplateSlotsModal onClose={() => setSlots(false)} />}
      {aiOpen && <ConnectionsModal onClose={() => useStore.setState({ aiOpen: false })} />}
    </div>
  )
}
