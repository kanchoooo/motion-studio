// Marking what to change on the video (feedback for Claude): an area (M) or pins (P), labelled and in
// the marks' colour — in the chat box.
import { MapPin, SquareDashed } from 'lucide-react'
import { useEditor } from './editorStore'

/** marking what to change on the video: an area (M) or a pin (P) — labelled, in the marks' colour */
export function ToolButtons({ compact }: { compact?: boolean }) {
  const { tool } = useEditor()
  const setTool = (t: 'select' | 'box' | 'pin') => useEditor.setState({ tool: tool === t ? 'select' : t })
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className={`mark-tool${tool === 'box' ? ' on' : ''}`} title="영역 표시 (M) — 바꿀 곳을 화면에 드래그해요. 표시마다 요청과 이미지·영상을 붙일 수 있어요" onClick={() => setTool('box')} data-testid="tool-box">
        <SquareDashed size={14} />
        {!compact && '영역'}
      </button>
      <button className={`mark-tool${tool === 'pin' ? ' on' : ''}`} title="핀 찍기 (P) — 바꿀 곳을 화면에서 클릭해요. 여러 개 찍을 수 있어요" onClick={() => setTool('pin')} data-testid="tool-pin">
        <MapPin size={14} />
        {!compact && '핀'}
      </button>
    </div>
  )
}
