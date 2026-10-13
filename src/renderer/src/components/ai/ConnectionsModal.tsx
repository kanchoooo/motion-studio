// "AI 연결": sign in to Higgsfield / Magnific (several accounts each, one in use)
// and turn Artlist on for Claude (Artlist signs in inside the Claude terminal).
import { useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, LogIn, Pencil, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { AI_PROVIDERS, type AiAccountInfo, type AiConnectProvider, type AiSettings } from '@shared/ai'
import { studio, useStore } from '../../store'
import { Modal, Toggle } from '../ui'

const CAN_LABEL = { image: '이미지', video: '영상', tts: '음성(TTS)', music: '음악', sfx: '효과음' } as const

export function ConnectionsModal({ onClose }: { onClose(): void }) {
  const { toast, project, setTerminal } = useStore()
  const [accounts, setAccounts] = useState<AiAccountInfo[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [adding, setAdding] = useState<AiConnectProvider | null>(null)
  const [label, setLabel] = useState('회사')
  const [waiting, setWaiting] = useState<AiConnectProvider | null>(null)

  useEffect(() => {
    void studio.ai.accounts().then(setAccounts)
    void studio.ai.settings().then(setSettings)
    return studio.ai.onLogin((e) => {
      if (e.status === 'waiting') return setWaiting(e.provider)
      setWaiting(null)
      if (e.status === 'done') {
        toast(`${AI_PROVIDERS[e.provider].name}에 연결했어요${e.account?.email ? ` (${e.account.email})` : ''}`, 'success')
        setAdding(null)
        void studio.ai.accounts().then(setAccounts)
      } else if (e.status === 'error') toast(e.message ?? '로그인하지 못했어요.', 'error')
    })
  }, [toast])

  const start = (provider: AiConnectProvider, relogin?: AiAccountInfo) => {
    setWaiting(provider)
    void studio.ai.login(provider, relogin ? relogin.label : label.trim() || '계정', relogin?.id)
  }

  return (
    <Modal title="AI 연결" onClose={onClose} width={680}>
      <div className="small muted" style={{ lineHeight: 1.6, marginTop: -4 }}>
        이미지·영상·음성 생성 서비스에 로그인하면 Claude가 대화나 브리프에 맞춰 소재를 만들어요. 서비스마다 회사·개인 계정을 여러 개 저장해 두고 골라 쓸 수 있어요. 사용량(크레딧)은 고른 계정에서 차감돼요.
      </div>

      {(['higgsfield', 'magnific'] as const).map((p) => {
        const meta = AI_PROVIDERS[p]
        const mine = accounts.filter((a) => a.provider === p)
        return (
          <div key={p} className="card" style={{ padding: 14 }} data-provider={p}>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="col grow" style={{ gap: 2 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 650 }}>{meta.name}</span>
                  {meta.can.map((c) => (
                    <span key={c} className="badge">{CAN_LABEL[c]}</span>
                  ))}
                </div>
                <span className="tiny faint">{mine.length ? `계정 ${mine.length}개` : '아직 연결된 계정이 없어요'}</span>
              </div>
              <button className="btn ghost sm" onClick={() => studio.app.openExternal(meta.site)} title="서비스 사이트 열기">
                <ExternalLink size={12} />
              </button>
              <button className="btn sm" onClick={() => setAdding(adding === p ? null : p)} disabled={!!waiting}>
                <Plus size={13} />
                계정 추가
              </button>
            </div>

            {mine.map((a) => (
              <AccountRow key={a.id} a={a} busy={!!waiting} onChange={setAccounts} onRelogin={() => start(p, a)} />
            ))}

            {adding === p && (
              <div className="col" style={{ gap: 8, marginTop: 8, padding: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small" style={{ width: 70 }}>계정 이름</span>
                  {['회사', '개인'].map((l) => (
                    <button key={l} className={`btn sm${label === l ? ' primary' : ''}`} onClick={() => setLabel(l)}>
                      {l}
                    </button>
                  ))}
                  <input className="input grow" style={{ height: 28 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 회사 팀 계정" />
                </div>
                <div className="row">
                  <span className="tiny muted grow">브라우저에서 {meta.name} 로그인 화면이 열려요. 로그인하고 허용하면 자동으로 연결돼요.</span>
                  {waiting === p ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span className="small">브라우저에서 로그인해 주세요</span>
                      <button className="btn sm" onClick={() => void studio.ai.cancelLogin()}>
                        취소
                      </button>
                    </>
                  ) : (
                    <button className="btn sm primary" onClick={() => start(p)} disabled={!!waiting}>
                      <LogIn size={13} />
                      로그인
                    </button>
                  )}
                </div>
              </div>
            )}
            {waiting === p && adding !== p && (
              <div className="row small" style={{ marginTop: 8 }}>
                <Loader2 size={14} className="spin" />
                <span className="grow">브라우저에서 로그인해 주세요</span>
                <button className="btn sm" onClick={() => void studio.ai.cancelLogin()}>
                  취소
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div className="card" style={{ padding: 14 }} data-provider="artlist">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontWeight: 650 }}>{AI_PROVIDERS.artlist.name}</span>
              {AI_PROVIDERS.artlist.can.map((c) => (
                <span key={c} className="badge">{CAN_LABEL[c]}</span>
              ))}
            </div>
            <span className="tiny faint">Claude가 아트리스트에서 배경음악·효과음을 찾아 사운드 패널에 보여줘요</span>
          </div>
          <Toggle
            on={!!settings?.artlist}
            onChange={async (v) => {
              setSettings(await studio.ai.saveSettings({ artlist: v }))
              toast(v ? '아트리스트를 켰어요. 쉬고 있는 Claude 대화는 바로 다시 연결돼요.' : '아트리스트를 껐어요', 'success')
            }}
          />
        </div>
        {settings?.artlist && (
          <div className="col tiny muted" style={{ gap: 4, lineHeight: 1.6, padding: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
            <span>
              로그인은 <b>Claude 터미널</b>에서 해요. 아트리스트 정책상 앱이 직접 로그인할 수 없어서, Claude Code가 로그인 정보를 보관해요(앱은 보지 않아요).
            </span>
            <span>1. 아래 버튼을 누르면 터미널에 MCP 화면이 열려요. 2. ↓로 <b>artlist</b>를 고르고 Enter → <b>Authenticate</b>. 3. 브라우저에서 로그인해요.</span>
            <span>계정을 바꾸려면 같은 화면에서 <b>Clear authentication</b>(로그아웃) 후 다른 계정으로 다시 로그인해요.</span>
            {project ? (
              <button
                className="btn sm"
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
                onClick={async () => {
                  setTerminal(true)
                  await studio.ai.artlistLogin(project.meta.id)
                  onClose()
                }}
              >
                <SquareTerminal size={13} />
                터미널에서 로그인하기
              </button>
            ) : (
              <span>프로젝트를 연 뒤 이 화면에서 로그인할 수 있어요.</span>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function AccountRow({ a, busy, onChange, onRelogin }: { a: AiAccountInfo; busy: boolean; onChange(list: AiAccountInfo[]): void; onRelogin(): void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(a.label)
  return (
    <div className="row" style={{ padding: '8px 4px', borderTop: '1px solid var(--border)', gap: 8 }} data-account={a.label}>
      <button
        className="icon-btn"
        title={a.active ? '사용 중인 계정' : '이 계정 사용하기'}
        onClick={async () => onChange(await studio.ai.setActive(a.provider, a.id))}
        style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${a.active ? 'var(--accent)' : 'var(--border-strong)'}`, background: a.active ? 'var(--accent)' : 'transparent' }}
      >
        {a.active && <Check size={12} color="var(--accent-text)" />}
      </button>
      <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
        {editing ? (
          <input
            className="input"
            style={{ height: 26 }}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => {
              setEditing(false)
              if (name.trim() && name !== a.label) onChange(await studio.ai.rename(a.id, name))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="small" style={{ fontWeight: a.active ? 650 : 500 }}>
            {a.label}
            {a.active && <span className="badge accent" style={{ marginLeft: 6 }}>사용 중</span>}
          </span>
        )}
        <span className="tiny faint ellipsis">{a.email ?? a.name ?? '로그인한 계정'}</span>
      </div>
      {a.needsLogin && <span className="badge warning">다시 로그인 필요</span>}
      <button className="btn ghost sm" onClick={onRelogin} disabled={busy} title="이 계정으로 다시 로그인">
        <LogIn size={12} />
        {a.needsLogin ? '로그인' : '다시 로그인'}
      </button>
      <button className="icon-btn" title="이름 바꾸기" onClick={() => setEditing(true)}>
        <Pencil size={13} />
      </button>
      <button
        className="icon-btn"
        title="이 계정 빼기"
        onClick={async () => {
          if (!confirm(`"${a.label}" 계정 연결을 뺄까요? 이 컴퓨터에 저장된 로그인 정보만 지워져요.`)) return
          onChange(await studio.ai.remove(a.id))
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}
