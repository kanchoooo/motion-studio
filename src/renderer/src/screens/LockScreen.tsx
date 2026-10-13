// First launch: the access password (asked once per computer).
import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Eye, EyeOff, Loader2 } from 'lucide-react'
import { studio, useStore } from '../store'

export function LockScreen() {
  const { go } = useStore()
  const [checking, setChecking] = useState(true)
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void studio.app.hasAccess().then((ok) => {
      if (ok) go('doctor')
      else {
        setChecking(false)
        setTimeout(() => input.current?.focus(), 50)
      }
    })
  }, [go])

  const submit = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    setWrong(false)
    const ok = await studio.app.unlock(value)
    setBusy(false)
    if (ok) go('doctor')
    else {
      setWrong(true)
      input.current?.select()
    }
  }

  if (checking) return <div className="drag" style={{ height: '100%' }} />
  return (
    <div className="drag" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="lock-screen">
      <div className="card no-drag col" style={{ width: 380, padding: 28, gap: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <Clapperboard size={20} color="var(--accent)" />
          <span className="h2">모션스튜디오</span>
        </div>
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          지인에게만 공유하는 앱이에요. 전달받은 암호를 입력해 주세요. 이 컴퓨터에서는 한 번만 입력하면 돼요.
        </div>
        <div className="row input" style={{ height: 40, padding: '0 6px 0 12px', gap: 6, borderColor: wrong ? 'var(--danger)' : undefined }}>
          {/*
            A plain text field: type=password and -webkit-text-security both make
            Chromium treat the field as a password and turn the Korean input method
            off on macOS. The typed text is drawn transparent and dots are laid over it.
          */}
          <div style={{ position: 'relative', flex: 1, alignSelf: 'stretch' }}>
            <input
              ref={input}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setWrong(false)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
              placeholder="암호"
              autoComplete="off"
              spellCheck={false}
              aria-label="암호"
              data-testid="access-input"
              style={{ position: 'absolute', inset: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: show ? 'var(--text)' : 'transparent', caretColor: show ? 'var(--text)' : 'transparent' }}
            />
            {!show && value && (
              <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 11, letterSpacing: 3, color: 'var(--text)' }}>
                {'●'.repeat([...value].length)}
                {focused && <span className="fake-caret" />}
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title={show ? '암호 숨기기' : '암호 보기'}
            onClick={() => {
              setShow(!show)
              input.current?.focus()
            }}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {wrong && <div className="small" style={{ color: 'var(--danger)', marginTop: -6 }}>암호가 맞지 않아요. 다시 확인해 주세요.</div>}
        <button className="btn primary lg" onClick={submit} disabled={!value.trim() || busy}>
          {busy && <Loader2 size={15} className="spin" />}
          시작하기
        </button>
      </div>
    </div>
  )
}
