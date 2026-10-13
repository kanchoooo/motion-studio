import { useState } from 'react'
import { ArrowLeft, Copy, Download, Radio, SquareTerminal } from 'lucide-react'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { studio, useStore, type ProjectTab } from '../store'
import { BriefTab } from './brief/BriefTab'
import { EditorTab } from './editor/EditorTab'
import { ExportModal } from './ExportModal'
import { HistoryTab } from './history/HistoryTab'
import { FamilyMenu } from './variations/FamilyMenu'
import { VariationModal } from './variations/VariationModal'

const TABS: { id: ProjectTab; label: string }[] = [
  { id: 'brief', label: '브리프' },
  { id: 'editor', label: '편집' },
  { id: 'history', label: '이력·결과물' },
]

export function Project() {
  const { project, tab, setTab, closeProject, session, terminalOpen, setTerminal, exportProgress } = useStore()
  const [exporting, setExporting] = useState(false)
  const [varying, setVarying] = useState(false)
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
        <FamilyMenu onCreate={() => setVarying(true)} />
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
          <button className={`icon-btn${terminalOpen ? ' active' : ''}`} title="터미널 열기/닫기" onClick={() => setTerminal(!terminalOpen)}>
            <SquareTerminal size={16} />
          </button>
          <ThemeSwitch />
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
        {tab === 'history' && <HistoryTab />}
      </div>
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
      {varying && <VariationModal onClose={() => setVarying(false)} />}
    </div>
  )
}
