// Picks a generation model from the connected services ("자동" = Claude chooses).
// Recommended models first; plan-limited ones are marked; any model can also be
// typed by name when the list does not have it.
import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { AI_PROVIDERS, CODEX_IMAGE_MODEL, type AiConnectProvider, type AiMediaKind, type AiModelInfo, type CodexStatus } from '@shared/ai'
import type { AiModelRef } from '@shared/brief'
import { studio } from '../../store'

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const TYPED = '__typed__'

export const resetModelCache = () => {}

export function ModelSelect({ kind, value, onChange, autoLabel = '자동 (Claude가 골라요)' }: { kind: AiMediaKind; value: AiModelRef | null | undefined; onChange(v: AiModelRef | null): void; autoLabel?: string }) {
  const [lists, setLists] = useState<Partial<Record<AiConnectProvider, { items: AiModelInfo[]; note?: string; error?: string }>> | null>(null)
  const [connected, setConnected] = useState<AiConnectProvider[]>([])
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [nonce, setNonce] = useState(0)
  // Codex CLI (GPT Image) for images, when it is installed on this computer
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  useEffect(() => {
    if (kind !== 'image') return
    let alive = true
    void studio.ai.codexStatus(nonce > 0).then((s) => alive && setCodex(s)).catch(() => null)
    return () => {
      alive = false
    }
  }, [kind, nonce])

  useEffect(() => {
    let alive = true
    setLists(null)
    void studio.ai.accounts().then(async (acc) => {
      const providers = [...new Set(acc.filter((a) => a.active && !a.needsLogin).map((a) => a.provider))]
      if (!alive) return
      setConnected(providers)
      const out: NonNullable<typeof lists> = {}
      await Promise.all(
        providers.map(async (p) => {
          try {
            out[p] = await studio.ai.models(p, kind)
          } catch (e) {
            out[p] = { items: [], error: errText(e) }
          }
        }),
      )
      if (alive) setLists(out)
    })
    return () => {
      alive = false
    }
  }, [kind, nonce])

  const all = Object.values(lists ?? {}).flatMap((l) => l?.items ?? [])
  const key = value ? `${value.provider}::${value.model}` : ''
  const known = !value || all.some((m) => m.provider === value.provider && m.id === value.model)
  const notes = Object.entries(lists ?? {}).flatMap(([p, l]) => [l?.error && `${AI_PROVIDERS[p as AiConnectProvider].name}: ${l.error}`, l?.note && `${AI_PROVIDERS[p as AiConnectProvider].name}: ${l.note}`].filter(Boolean) as string[])

  if (typing)
    return (
      <div className="row" style={{ gap: 6 }}>
        <select className="select" style={{ width: 110, flex: 'none' }} value={value?.provider ?? connected[0] ?? 'magnific'} onChange={(e) => typed && onChange({ provider: e.target.value as AiConnectProvider, model: typed, label: typed })}>
          {(['magnific', 'higgsfield'] as const).map((p) => (
            <option key={p} value={p}>
              {AI_PROVIDERS[p].name}
            </option>
          ))}
        </select>
        <input
          className="input"
          autoFocus
          placeholder="모델 이름 (예: Nano Banana Pro)"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => {
            if (typed.trim()) onChange({ provider: value?.provider ?? connected[0] ?? 'magnific', model: typed.trim(), label: typed.trim() })
            setTyping(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
    )

  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <select
          className="select"
          value={key}
          onChange={(e) => {
            if (e.target.value === TYPED) {
              setTyped(value?.label ?? '')
              return setTyping(true)
            }
            if (!e.target.value) return onChange(null)
            if (e.target.value === `codex::${CODEX_IMAGE_MODEL}`) return onChange({ provider: 'codex', model: CODEX_IMAGE_MODEL, label: 'GPT 이미지 (Codex)' })
            const [provider, model] = e.target.value.split('::')
            const m = all.find((x) => x.provider === provider && x.id === model)
            onChange({ provider: provider as AiConnectProvider, model, label: m?.name })
          }}
        >
          <option value="">{autoLabel}</option>
          {!known && value && value.provider !== 'codex' && <option value={key}>{value.label ?? value.model} ({AI_PROVIDERS[value.provider].name})</option>}
          {codex?.installed && (
            <optgroup label="Codex CLI (내 ChatGPT 계정)">
              <option value={`codex::${CODEX_IMAGE_MODEL}`} disabled={!codex.usable && value?.provider !== 'codex'} title={codex.reason}>
                GPT 이미지 (Codex){codex.usable ? '' : ' — 지금 사용 불가'}
              </option>
            </optgroup>
          )}
          {(['magnific', 'higgsfield'] as const).map((p) => {
            const items = lists?.[p]?.items ?? []
            if (!items.length) return null
            return (
              <optgroup key={p} label={AI_PROVIDERS[p].name}>
                {items.map((m) => (
                  <option key={m.id} value={`${p}::${m.id}`} disabled={m.unavailable} title={m.description}>
                    {m.recommended ? '★ ' : ''}
                    {m.name}
                    {m.unavailable ? ' (지금 플랜으로는 사용 불가)' : m.premium ? ' · 유료 플랜' : ''}
                  </option>
                ))}
              </optgroup>
            )
          })}
          <option value={TYPED}>직접 입력…</option>
        </select>
        {lists === null && connected.length > 0 && <Loader2 size={14} className="spin" />}
        {lists !== null && !connected.length && !codex?.usable && <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>AI 연결 필요</span>}
        {notes.length > 0 && (
          <button className="icon-btn" title="다시 불러오기" onClick={() => setNonce((n) => n + 1)}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      {notes.map((n) => (
        <span key={n} className="tiny" style={{ color: 'var(--warning)' }}>{n}</span>
      ))}
      {value?.provider === 'codex' && <CodexLine status={codex} onRefresh={() => setNonce((n) => n + 1)} />}
    </div>
  )
}

/** "Codex · plus · 5시간 0% · 주간 6% 사용" or why it cannot be used now */
export function CodexLine({ status, onRefresh }: { status: CodexStatus | null; onRefresh?(): void }) {
  if (!status) return <span className="tiny faint">Codex 상태를 확인하고 있어요…</span>
  return (
    <div className="row tiny" style={{ gap: 6, color: status.usable ? 'var(--text-3)' : 'var(--warning)', flexWrap: 'wrap' }} data-testid="codex-line">
      <span className="grow">
        {status.usable
          ? `Codex · ${status.plan ?? 'ChatGPT'}${status.limits.length ? ` · ${status.limits.map((l) => `${l.label} ${Math.round(l.usedPercent)}%`).join(' · ')} 사용` : ''} · 내 ChatGPT 한도에서 써요`
          : status.reason}
      </span>
      {onRefresh && (
        <button className="btn ghost sm" style={{ height: 20, padding: '0 6px', fontSize: 11 }} onClick={onRefresh} title="Codex 한도를 다시 확인해요 (토큰을 쓰지 않아요)">
          새로 조회
        </button>
      )}
    </div>
  )
}
