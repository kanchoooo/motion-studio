// "Claude API 키" in AI 연결: the designer's API key (e.g. promotion credits) runs the Claude conversation
// first; when it stops working the Claude subscription takes over by itself.
import { useEffect, useState } from 'react'
import { Check, ExternalLink, KeyRound, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { FAILURE_TEXT, usd, type ClaudeAuthStatus } from '@shared/claudeApi'
import { studio, useStore } from '../../store'
import { Segmented } from '../ui'

const KEYS_PAGE = 'https://platform.claude.com/settings/keys'
const BILLING_PAGE = 'https://platform.claude.com/settings/billing'
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function ClaudeKeyCard() {
  const { toast } = useStore()
  const [st, setSt] = useState<ClaudeAuthStatus | null>(null)
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState('')

  useEffect(() => {
    void studio.claudeApi.status().then(setSt)
    return studio.agent.onEvent((e) => {
      if (e.type === 'claude-auth') setSt(e.status)
      else if (e.type === 'api-cost') void studio.claudeApi.status().then(setSt)
    })
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      setSt(await studio.claudeApi.saveKey(key))
      setKey('')
      setEditing(false)
      toast('API 키를 확인하고 저장했어요. 이제 Claude 대화는 이 키로 먼저 해요.', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const left = st?.balance ? Math.max(0, st.balance.usd - st.balance.spentSince) : null

  return (
    <div className="card" style={{ padding: 14 }} data-provider="claude-api" data-testid="claude-key-card">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="col grow" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 650 }}>Claude API 키</span>
            <span className="badge">Claude 대화</span>
          </div>
          <span className="tiny faint">API 키를 넣으면 Claude 대화를 이 키로 먼저 해요. 크레딧이 떨어지거나 한도에 닿으면 Claude 구독으로 바꿔 하던 대화를 그대로 이어가요.</span>
        </div>
        {st?.hasKey && (
          <div data-testid="claude-key-mode">
            <Segmented
              value={st.enabled ? 'api' : 'subscription'}
              onChange={async (v) => {
                let next = await studio.claudeApi.setEnabled(v === 'api')
                if (v === 'api' && next.fallback) next = await studio.claudeApi.retry()
                setSt(next)
                toast(v === 'api' ? '이제 Claude 대화를 API 키로 먼저 해요. 쉬고 있는 대화는 바로 다시 연결돼요.' : '이제 Claude 대화를 구독으로만 해요. 키는 저장된 채로 있어요.', 'success')
              }}
              options={[
                { value: 'api', label: 'API 키 먼저' },
                { value: 'subscription', label: '구독만' },
              ]}
            />
          </div>
        )}
      </div>

      {!st ? (
        <div className="tiny muted">확인하고 있어요…</div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {st.hasKey && !editing && (
            <div className="col tiny" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                <KeyRound size={12} className="muted" />
                <span className="mono" data-testid="claude-key-hint">sk-ant-…{st.hint}</span>
                {st.savedAt && <span className="faint">· {when(st.savedAt)} 저장</span>}
                <span className="grow" />
                <button className="btn ghost sm" onClick={() => setEditing(true)}>키 바꾸기</button>
                <button
                  className="icon-btn"
                  title="이 컴퓨터에서 키 지우기"
                  data-testid="claude-key-remove"
                  onClick={async () => {
                    if (!confirm('저장한 API 키를 이 컴퓨터에서 지울까요? 이후 Claude 대화는 구독으로 해요.')) return
                    setSt(await studio.claudeApi.removeKey())
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="row" style={{ gap: 6 }} data-testid="claude-key-using">
                {st.using === 'api' ? (
                  <span className="row" style={{ gap: 4, color: 'var(--success)' }}>
                    <Check size={12} />
                    지금 API 키로 대화해요
                  </span>
                ) : st.fallback ? (
                  <span style={{ color: 'var(--warning)' }}>
                    {FAILURE_TEXT[st.fallback.reason]}. {when(st.fallback.at)}부터 Claude 구독으로 대화해요{st.fallback.retryAt ? ` (${when(st.fallback.retryAt)}부터 다시 API 키)` : ''}.
                  </span>
                ) : (
                  <span className="muted">꺼 둠 · Claude 구독으로 대화해요</span>
                )}
                {st.fallback && (
                  <button className="btn ghost sm" data-testid="claude-key-retry" onClick={async () => setSt(await studio.claudeApi.retry())} title="크레딧을 채웠거나 한도를 올렸으면 다음 요청부터 API 키로 해요">
                    <RotateCcw size={12} />
                    다시 API 키로
                  </button>
                )}
              </div>
            </div>
          )}

          {(!st.hasKey || editing) && (
            <div className="col" style={{ gap: 6, padding: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input grow mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ height: 28 }}
                  placeholder="sk-ant-api03-…"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
                  data-testid="claude-key-input"
                />
                <button className="btn sm primary" disabled={!key.trim() || busy} onClick={() => void save()} data-testid="claude-key-save">
                  {busy ? <Loader2 size={12} className="spin" /> : null}
                  확인하고 저장
                </button>
                {editing && (
                  <button className="btn sm" onClick={() => (setEditing(false), setKey(''))}>
                    취소
                  </button>
                )}
              </div>
              <span className="tiny muted">
                Claude Console의 API Keys에서 만든 키를 붙여넣어요. 저장하기 전에 키가 맞는지 확인해요(요금은 나가지 않아요). 키는 이 컴퓨터에만 저장되고 Claude 대화에만 써요.
              </span>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => studio.app.openExternal(KEYS_PAGE)}>
                <ExternalLink size={12} />
                Console에서 키 만들기
              </button>
            </div>
          )}

          {st.hasKey && (
            <div className="col tiny" style={{ gap: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }} data-testid="claude-key-spend">
              <div className="row" style={{ gap: 6 }}>
                <span className="muted" style={{ width: 92 }}>이번 달 사용</span>
                <span className="mono">{usd(st.month.usd)}</span>
                <span className="faint">이 컴퓨터 · 정가로 계산한 추정</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="muted" style={{ width: 92 }}>남은 크레딧</span>
                {left != null ? (
                  <>
                    <span className="mono" data-testid="claude-key-left">약 {usd(left)}</span>
                    <span className="faint">
                      ({when(st.balance!.at)}에 넣은 {usd(st.balance!.usd)} − 이 컴퓨터에서 쓴 {usd(st.balance!.spentSince)})
                    </span>
                  </>
                ) : (
                  <span className="faint">API로는 잔액을 알 수 없어요. Console에서 본 잔액을 넣으면 쓴 만큼 빼서 보여줘요.</span>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ width: 92 }} />
                <input
                  className="input mono"
                  style={{ height: 26, width: 110 }}
                  inputMode="decimal"
                  placeholder="예: 50"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value.replace(/[^\d.]/g, ''))}
                  data-testid="claude-key-balance"
                />
                <button
                  className="btn ghost sm"
                  disabled={!balance}
                  onClick={async () => {
                    setSt(await studio.claudeApi.setBalance(Number(balance)))
                    setBalance('')
                  }}
                >
                  잔액 넣기 ($)
                </button>
                <button className="btn ghost sm" onClick={() => studio.app.openExternal(BILLING_PAGE)}>
                  <ExternalLink size={12} />
                  Console 잔액 보기
                </button>
              </div>
              <span className="faint">같은 키(같은 계정)를 다른 컴퓨터에서도 쓰면, 그 컴퓨터에서 쓴 만큼은 여기서 빠지지 않아요.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
