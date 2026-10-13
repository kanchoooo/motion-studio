// Picks a generation model from the connected services ("자동" = Claude chooses).
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AI_PROVIDERS, type AiAccountInfo, type AiMediaKind, type AiModelInfo } from '@shared/ai'
import type { AiModelRef } from '@shared/brief'
import { studio } from '../../store'

const cache = new Map<string, Promise<AiModelInfo[]>>()
function models(provider: AiAccountInfo['provider'], kind: AiMediaKind) {
  const key = `${provider}:${kind}`
  if (!cache.has(key)) cache.set(key, studio.ai.models(provider, kind).catch(() => []))
  return cache.get(key)!
}
export const resetModelCache = () => cache.clear()

export function ModelSelect({ kind, value, onChange, autoLabel = '자동 (Claude가 골라요)' }: { kind: AiMediaKind; value: AiModelRef | null | undefined; onChange(v: AiModelRef | null): void; autoLabel?: string }) {
  const [list, setList] = useState<AiModelInfo[] | null>(null)
  const [accounts, setAccounts] = useState<AiAccountInfo[]>([])
  useEffect(() => {
    let alive = true
    void studio.ai.accounts().then(async (acc) => {
      if (!alive) return
      setAccounts(acc)
      const providers = [...new Set(acc.filter((a) => a.active && !a.needsLogin).map((a) => a.provider))]
      const all = (await Promise.all(providers.map((p) => models(p, kind)))).flat()
      if (alive) setList(all)
    })
    return () => {
      alive = false
    }
  }, [kind])
  const connected = accounts.some((a) => !a.needsLogin)
  const key = value ? `${value.provider}::${value.model}` : ''
  const known = !value || (list ?? []).some((m) => m.provider === value.provider && m.id === value.model)
  return (
    <div className="row" style={{ gap: 6 }}>
      <select
        className="select"
        value={key}
        onChange={(e) => {
          if (!e.target.value) return onChange(null)
          const [provider, model] = e.target.value.split('::')
          const m = list?.find((x) => x.provider === provider && x.id === model)
          onChange({ provider: provider as AiModelRef['provider'], model, label: m?.name })
        }}
      >
        <option value="">{autoLabel}</option>
        {!known && value && <option value={key}>{value.label ?? value.model} ({AI_PROVIDERS[value.provider].name})</option>}
        {(['higgsfield', 'magnific'] as const).map((p) => {
          const items = (list ?? []).filter((m) => m.provider === p)
          if (!items.length) return null
          return (
            <optgroup key={p} label={AI_PROVIDERS[p].name}>
              {items.map((m) => (
                <option key={m.id} value={`${p}::${m.id}`} title={m.description}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
      {list === null && <Loader2 size={14} className="spin" />}
      {list !== null && !connected && <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>AI 연결 필요</span>}
    </div>
  )
}
