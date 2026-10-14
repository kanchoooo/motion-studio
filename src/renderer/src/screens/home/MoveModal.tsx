// "다른 폴더로 옮기기": pick the folder a project goes to.
import { useState } from 'react'
import { Folder, Home as HomeIcon } from 'lucide-react'
import type { ProjectSummary } from '@shared/project'
import { Modal } from '../../components/ui'
import { useStore } from '../../store'
import { depthOf, folderName, folderOptions } from './folders'

export function MoveModal({ project, onMove, onClose }: { project: ProjectSummary; onMove(to: string): Promise<void>; onClose(): void }) {
  const { folders } = useStore()
  const [to, setTo] = useState(project.folder)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={`"${project.name}" 옮기기`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={busy || to === project.folder}
            onClick={async () => {
              setBusy(true)
              await onMove(to)
              onClose()
            }}
            data-testid="move-confirm"
          >
            {folderName(to)}(으)로 옮기기
          </button>
        </>
      }
    >
      <div className="small muted">베리에이션은 원본 카드에 그대로 함께 보여요. Claude 대화도 그대로 이어져요.</div>
      <div className="col" style={{ gap: 2, maxHeight: 320, overflow: 'auto' }} data-testid="move-folders">
        {folderOptions(folders).map((o) => (
          <div key={o.value || 'root'} className="tree-row" data-on={to === o.value ? '1' : undefined} style={{ paddingLeft: 8 + depthOf(o.value) * 14 }} onClick={() => setTo(o.value)} data-folder={o.value}>
            {o.value ? <Folder size={14} /> : <HomeIcon size={14} />}
            <span className="grow">{o.value ? folderName(o.value) : '프로젝트 (맨 위)'}</span>
            {o.value === project.folder && <span className="tiny faint">지금 위치</span>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
