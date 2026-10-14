// "AI 연결": sign in to Higgsfield / Magnific (several accounts each, one in use)
// and turn Artlist on for Claude (Artlist signs in inside the Claude terminal).
import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, LogIn, Pencil, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { AI_PROVIDERS, type AiAccountInfo, type AiConnectProvider, type AiSettings, type CodexStatus, type LoginBrowser, type LoginWindow } from '@shared/ai'
import { studio, useStore } from '../../store'
import { XTerm } from '../XTerm'
import { Modal, Segmented, Toggle } from '../ui'

const CAN_LABEL = { image: '이미지', video: '영상', tts: '음성(TTS)', music: '음악', sfx: '효과음' } as const

// the designer's choice of sign-in window, remembered on this computer
const WINDOW_KEY = 'ms-login-window'
function savedWindow(): LoginWindow {
  try {
    const w = JSON.parse(localStorage.getItem(WINDOW_KEY) ?? 'null') as LoginWindow | null
    if (w && (w.mode === 'private' || w.mode === 'normal') && typeof w.browser === 'string') return w
  } catch {
    /* storage unavailable */
  }
  return { mode: 'private', browser: '' }
}

/** keeps the chosen browser when it fits the mode, otherwise the best one installed */
function fitWindow(w: LoginWindow, list: LoginBrowser[]): LoginWindow {
  const has = list.some((b) => b.id === w.browser)
  if (w.mode === 'normal') return has || w.browser === 'default' ? w : { mode: 'normal', browser: 'default' }
  if (has || w.browser === 'copy') return w
  return { mode: 'private', browser: (list.find((b) => b.canPrivate) ?? list[0])?.id ?? 'copy' }
}

/** e.g. "Chrome 시크릿 창", "기본 브라우저" */
function windowName(w: LoginWindow, list: LoginBrowser[]) {
  const b = list.find((x) => x.id === w.browser)
  if (w.mode === 'normal') return b ? b.name : '기본 브라우저'
  return b ? `${b.name} ${b.privateName}` : '시크릿 창'
}

export function ConnectionsModal({ onClose }: { onClose(): void }) {
  const { toast } = useStore()
  const [accounts, setAccounts] = useState<AiAccountInfo[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [adding, setAdding] = useState<AiConnectProvider | null>(null)
  const [label, setLabel] = useState('회사')
  const [waiting, setWaiting] = useState<AiConnectProvider | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [browsers, setBrowsers] = useState<LoginBrowser[]>([])
  const [win, setWinState] = useState<LoginWindow>(savedWindow)
  const setWin = (w: LoginWindow) => {
    const next = fitWindow(w, browsers)
    setWinState(next)
    try {
      localStorage.setItem(WINDOW_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable: asked again next time */
    }
  }
  const [artlistTerm, setArtlistTerm] = useState(false)

  useEffect(() => {
    void studio.ai.accounts().then(setAccounts)
    void studio.ai.settings().then(setSettings)
    void studio.ai.browsers().then((b) => {
      setBrowsers(b)
      // a private window by default: the browser's signed-in account (often the company one) is not reused
      setWinState((w) => fitWindow(w, b))
    })
    return studio.ai.onLogin((e) => {
      if (e.status === 'waiting') {
        if (e.url) {
          setLoginUrl(e.url)
          setCopied(!!e.copied)
        }
        return setWaiting(e.provider)
      }
      setWaiting(null)
      setLoginUrl(null)
      setCopied(false)
      if (e.status === 'done') {
        toast(`${AI_PROVIDERS[e.provider].name}에 연결했어요${e.account?.email ? ` (${e.account.email})` : ''}`, 'success')
        setAdding(null)
        void studio.ai.accounts().then(setAccounts)
      } else if (e.status === 'error') toast(e.message ?? '로그인하지 못했어요.', 'error')
    })
  }, [toast])

  const start = (provider: AiConnectProvider, relogin?: AiAccountInfo) => {
    setWaiting(provider)
    setLoginUrl(null)
    setCopied(false)
    void studio.ai.login(provider, relogin ? relogin.label : label.trim() || '계정', { relogin: relogin?.id, window: win })
  }

  const safari = win.browser === 'safari'

  const waitingRow = (
    <div className="col" style={{ gap: 6 }}>
      <div className="row small">
        <Loader2 size={14} className="spin" />
        <span className="grow">
          {copied
            ? safari
              ? '로그인 주소를 복사했어요. 사파리에서 ⇧⌘N으로 개인 정보 보호 창을 열고, 주소창에 붙여넣어(⌘V) 로그인해 주세요.'
              : '로그인 주소를 복사했어요. 원하는 브라우저의 시크릿 창을 열고, 주소창에 붙여넣어 로그인해 주세요.'
            : `${windowName(win, browsers)}에서 로그인해 주세요`}
        </span>
        <button className="btn sm" onClick={() => void studio.ai.cancelLogin()}>
          취소
        </button>
      </div>
      {loginUrl && (
        <div className="row tiny muted" style={{ gap: 6 }}>
          <span className="grow">{copied ? '복사가 안 됐으면 다시 복사해요.' : '창이 안 열리거나 다른 브라우저에서 하려면 주소를 복사해 붙여넣으세요.'}</span>
          <button
            className="btn ghost sm"
            onClick={async () => {
              await navigator.clipboard.writeText(loginUrl)
              toast('로그인 주소를 복사했어요', 'success')
            }}
          >
            <Copy size={12} />
            주소 복사
          </button>
        </div>
      )}
    </div>
  )

  const privateOptions = [
    ...browsers.map((b) => ({ value: b.id, label: b.canPrivate ? `${b.name} ${b.privateName}` : `${b.name} ${b.privateName} (주소를 복사해 직접 열기)` })),
    { value: 'copy', label: '주소만 복사 (다른 브라우저에서 직접 열기)' },
  ]
  const normalOptions = [{ value: 'default', label: '기본 브라우저' }, ...browsers.map((b) => ({ value: b.id, label: b.name }))]
  const windowPicker = (
    <div className="col" style={{ gap: 6, padding: 12, borderRadius: 8, background: 'var(--surface-2)', opacity: waiting ? 0.6 : 1, pointerEvents: waiting ? 'none' : undefined }} data-testid="login-window">
      <div className="row" style={{ gap: 8 }}>
        <span className="small" style={{ fontWeight: 600, width: 64 }}>로그인 창</span>
        <Segmented
          value={win.mode}
          onChange={(mode) => setWin({ mode, browser: mode === 'normal' ? 'default' : win.browser })}
          options={[
            { value: 'private', label: '시크릿 창' },
            { value: 'normal', label: '일반 창' },
          ]}
        />
        <select className="select grow" style={{ height: 28 }} value={win.browser} onChange={(e) => setWin({ ...win, browser: e.target.value })} data-testid="login-browser">
          {(win.mode === 'private' ? privateOptions : normalOptions).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <span className="tiny muted" style={{ paddingLeft: 72 }}>
        {win.mode === 'private'
          ? '브라우저에 로그인된 계정(회사 계정 등)과 상관없이, 원하는 계정으로 새로 로그인해요. 계정 추가·다시 로그인 모두 이 창으로 열려요.'
          : '브라우저에 이미 로그인된 계정이 있으면 그 계정으로 바로 연결될 수 있어요. 계정 추가·다시 로그인 모두 이 창으로 열려요.'}
      </span>
    </div>
  )

  return (
    <Modal
      title="AI 연결"
      onClose={() => {
        if (artlistTerm) void studio.ai.artlistLoginDone()
        onClose()
      }}
      width={artlistTerm ? 820 : 680}
    >
      <div className="small muted" style={{ lineHeight: 1.6, marginTop: -4 }}>
        이미지·영상·음성 생성 서비스에 로그인하면 Claude가 대화나 브리프에 맞춰 소재를 만들어요. 서비스마다 회사·개인 계정을 여러 개 저장해 두고 골라 쓸 수 있어요. 사용량(크레딧)은 고른 계정에서 차감돼요.
      </div>
      {windowPicker}

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
                {waiting === p ? (
                  waitingRow
                ) : (
                  <div className="row">
                    <span className="tiny muted grow">{meta.name} 로그인 화면이 열려요. 로그인하고 허용하면 자동으로 연결돼요.</span>
                    <button className="btn sm primary" onClick={() => start(p)} disabled={!!waiting}>
                      <LogIn size={13} />
                      로그인
                    </button>
                  </div>
                )}
              </div>
            )}
            {waiting === p && adding !== p && <div style={{ marginTop: 8 }}>{waitingRow}</div>}
          </div>
        )
      })}

      <CodexCard />

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
        {settings?.artlist && !artlistTerm && (
          <div className="col tiny muted" style={{ gap: 6, lineHeight: 1.6, padding: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
            <span>
              아트리스트는 앱이 직접 로그인할 수 없어서 <b>Claude Code</b>가 로그인 정보를 보관해요(앱은 보지 않아요). 아래 버튼을 누르면 로그인 창이 이 화면에 열려요.
            </span>
            <button
              className="btn sm primary"
              style={{ alignSelf: 'flex-start' }}
              data-testid="artlist-login"
              onClick={async () => {
                setArtlistTerm(true)
                await studio.ai.artlistLogin()
              }}
            >
              <SquareTerminal size={13} />
              아트리스트 로그인
            </button>
          </div>
        )}
        {settings?.artlist && artlistTerm && (
          <div className="col" style={{ gap: 8 }}>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>처음이면 폴더 신뢰 화면이 나와요: ↓ 키로 "Yes, I trust this folder"를 고르고 Enter.</li>
              <li>MCP 목록에서 ↑↓로 <b>artlist</b>를 고르고 Enter → <b>Authenticate</b>에서 Enter.</li>
              <li>브라우저에서 아트리스트에 로그인하고 허용하면 끝이에요. 목록에 ✔ connected가 보이면 아래 완료를 눌러요.</li>
              <li>계정을 바꾸려면 같은 화면에서 <b>Clear authentication</b> 후 다시 Authenticate.</li>
            </ol>
            <div style={{ height: 300, display: 'flex', background: '#0f0f11', borderRadius: 8, padding: '8px 0 0 10px' }} data-testid="artlist-terminal">
              <XTerm sessionId="__artlist__" />
            </div>
            <div className="row">
              <span className="tiny muted grow">완료하면 열려 있는 프로젝트의 Claude가 다시 연결돼서 아트리스트를 쓸 수 있어요.</span>
              <button
                className="btn sm primary"
                onClick={async () => {
                  await studio.ai.artlistLoginDone()
                  setArtlistTerm(false)
                  toast('아트리스트 로그인을 마쳤어요. 쉬고 있는 Claude 대화는 바로 다시 연결돼요.', 'success')
                }}
              >
                완료
              </button>
            </div>
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

/** Codex CLI: the designer's own ChatGPT login on this computer makes images (GPT Image) */
function CodexCard() {
  const [st, setSt] = useState<CodexStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (force: boolean) => {
    setBusy(true)
    try {
      setSt(await studio.ai.codexStatus(force))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load(false)
  }, [])
  return (
    <div className="card" style={{ padding: 14 }} data-provider="codex">
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="col grow" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 650 }}>Codex CLI</span>
            <span className="badge">이미지 (GPT 이미지)</span>
          </div>
          <span className="tiny faint">이 컴퓨터의 Codex에 ChatGPT로 로그인돼 있으면, 모델 목록에서 "GPT 이미지 (Codex)"를 고를 수 있어요. 내 ChatGPT 한도에서 써요.</span>
        </div>
        <button className="btn ghost sm" disabled={busy} onClick={() => void load(true)} title="Codex에 다시 물어봐요 (토큰을 쓰지 않아요)">
          {busy ? <Loader2 size={12} className="spin" /> : null}
          새로 조회
        </button>
      </div>
      {!st ? (
        <div className="tiny muted">확인하고 있어요…</div>
      ) : !st.installed ? (
        <div className="tiny muted">이 컴퓨터에 Codex CLI가 없어요. 쓰려면 터미널에서 <span className="mono">npm i -g @openai/codex</span>로 설치하고 <span className="mono">codex login</span>을 해 주세요.</div>
      ) : (
        <div className="col tiny" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 6, color: st.usable ? 'var(--success)' : 'var(--warning)' }}>
            {st.usable ? <Check size={12} /> : null}
            <span>{st.usable ? `사용할 수 있어요 · ${st.email ?? ''} (${st.plan ?? 'ChatGPT'})` : st.reason}</span>
          </div>
          {st.limits.map((l) => (
            <div key={l.label} className="row" style={{ gap: 8 }}>
              <span style={{ width: 48 }} className="muted">{l.label}</span>
              <div className="progress grow" style={{ height: 6 }}>
                <div style={{ width: `${Math.min(100, l.usedPercent)}%`, background: l.usedPercent >= 90 ? 'var(--warning)' : undefined }} />
              </div>
              <span className="mono" style={{ width: 190, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {Math.round(l.usedPercent)}% 사용{l.resetsAt ? ` · ${new Date(l.resetsAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
