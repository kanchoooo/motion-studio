// Brief defaults for AI generation (image / video model, narration voice and
// script). The chat always wins: "3번 씬 배경은 ○○ 모델로 다시 만들어줘".
import { useState } from 'react'
import { Link2, Mic, Music } from 'lucide-react'
import type { Brief } from '@shared/brief'
import { ConnectionsModal } from '../../components/ai/ConnectionsModal'
import { ModelSelect, resetModelCache } from '../../components/ai/ModelSelect'
import { VoiceBrowser } from '../../components/ai/VoiceBrowser'
import { Field, Toggle } from '../../components/ui'
import { SectionHeader } from './BriefTab'

export function AiSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const ai = brief.ai
  const set = (p: Partial<Brief['ai']>) => onChange({ ...brief, ai: { ...ai, ...p } })
  const setN = (p: Partial<Brief['ai']['narration']>) => set({ narration: { ...ai.narration, ...p } })
  const [connections, setConnections] = useState(false)
  const [nonce, setNonce] = useState(0)

  return (
    <div className="col" style={{ gap: 18 }} data-testid="ai-section">
      <SectionHeader title="AI 생성·음성" desc="필요한 이미지·영상 소스와 내레이션을 AI로 만들 때 쓸 기본값이에요. 대화에서 “어디를 무슨 모델로 만들어줘”라고 하면 대화가 우선이에요." />
      <div className="row small" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
        <Link2 size={14} />
        <span className="grow">힉스필드·매그니픽·아트리스트 계정 연결과 회사/개인 계정 전환은 AI 연결에서 해요.</span>
        <button className="btn sm" onClick={() => setConnections(true)}>
          AI 연결
        </button>
      </div>

      <div key={nonce} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="이미지 생성 기본 모델" hint="스토리보드에서 '말로 설명'한 이미지, 배경, 소품 등을 만들 때 써요.">
          <ModelSelect kind="image" value={ai.image} onChange={(image) => set({ image })} />
        </Field>
        <Field label="영상 생성 기본 모델" hint="실사 컷·배경 영상 같은 영상 소스를 만들 때 써요.">
          <ModelSelect kind="video" value={ai.video} onChange={(video) => set({ video })} />
        </Field>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ marginBottom: ai.narration.enabled ? 14 : 0 }}>
          <Mic size={15} />
          <span className="grow" style={{ fontWeight: 650 }}>내레이션 (TTS)</span>
          <Toggle on={ai.narration.enabled} onChange={(enabled) => setN({ enabled })} />
        </div>
        {ai.narration.enabled && (
          <div className="col" style={{ gap: 14 }}>
            <Field label="목소리" hint={ai.narration.voiceName ? `선택됨: ${ai.narration.voiceName} · 다시 누르면 선택을 풀어요` : '목록에서 듣고 골라 주세요. 비워 두면 Claude가 톤에 맞게 골라요.'}>
              <VoiceBrowser
                selected={{ provider: ai.narration.provider, voiceId: ai.narration.voiceId }}
                onPick={(v) => setN(v ? { provider: v.provider, voiceId: v.id, voiceName: v.name, voiceType: v.voiceType ?? v.source } : { provider: undefined, voiceId: undefined, voiceName: undefined, voiceType: undefined })}
                height={300}
              />
            </Field>
            <Field label="대본" hint="비워 두면 Claude가 톤앤매너와 스토리보드에 맞춰 써요. 줄마다 한 문장씩 적으면 장면에 맞춰 나눠 넣어요.">
              <textarea className="textarea" rows={4} placeholder={'예)\n봄이 왔어요.\n모션커피의 새로운 시즌 메뉴를 만나보세요.'} value={ai.narration.script} onChange={(e) => setN({ script: e.target.value })} />
            </Field>
            <Field label="메모">
              <input className="input" placeholder="예: 밝고 또박또박, 마지막 문장은 천천히" value={ai.narration.note} onChange={(e) => setN({ note: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row">
          <Music size={15} />
          <div className="col grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: 650 }}>아트리스트에서 음악·효과음 찾기</span>
            <span className="tiny muted">켜면 Claude가 배경음악·효과음을 아트리스트에서 찾아요. 아트리스트가 AI 연결에서 켜져 있고 로그인돼 있어야 해요.</span>
          </div>
          <Toggle on={ai.artlist} onChange={(artlist) => set({ artlist })} />
        </div>
      </div>

      {connections && (
        <ConnectionsModal
          onClose={() => {
            setConnections(false)
            resetModelCache()
            setNonce((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
