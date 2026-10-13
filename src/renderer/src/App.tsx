import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useStore } from './store'
import { Doctor } from './screens/Doctor'
import { Home } from './screens/Home'
import { Project } from './screens/Project'
import { TerminalPanel } from './screens/editor/TerminalPanel'
import { LoginModal } from './components/LoginModal'
import { LockScreen } from './screens/LockScreen'
import { UpdateScreen } from './screens/UpdateScreen'

export function App() {
  const { screen, toasts, project } = useStore()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'clip' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'clip' }}>
        {screen === 'update' && <UpdateScreen />}
        {screen === 'lock' && <LockScreen />}
        {screen === 'doctor' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="drag" style={{ height: 'var(--titlebar)', flex: 'none' }} />
            <div style={{ flex: 1, minHeight: 0 }}>
              <Doctor />
            </div>
          </div>
        )}
        {screen === 'home' && <Home />}
        {/* keyed: drafts and panel state of one project never carry over to another */}
        {screen === 'project' && project && <Project key={project.meta.id} />}
      </div>
      {/* the live terminal belongs to the open project and survives tab switches */}
      {screen === 'project' && project && <TerminalPanel key={project.meta.id} />}
      <LoginModal />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <AlertCircle size={16} color="var(--danger)" /> : t.kind === 'success' ? <CheckCircle2 size={16} color="var(--success)" /> : <Info size={16} />}
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
