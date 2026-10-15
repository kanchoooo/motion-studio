// "예상 4.8 크레딧 · 남은 20.14": what a generation would cost with the settings in the form and
// what is left on the account. Read-only checks on the service (nothing is submitted or charged),
// asked again a moment after the settings change.
import { useEffect, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'
import type { CreditInfo } from '@shared/ai'
import type { GenRequest, VideoGenRequest } from '@shared/assetGen'
import { studio } from '../../store'

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ko-KR')

export function CreditLine({ req, kind }: { req: GenRequest | VideoGenRequest | null; kind: 'image' | 'video' }) {
  const [info, setInfo] = useState<CreditInfo | null>(null)
  const [busy, setBusy] = useState(false)
  // the settings that change the price (not the prompt's words)
  const v = req as VideoGenRequest | null
  const key = req ? JSON.stringify({ p: req.provider, m: req.model, r: req.ratio, d: v?.duration, a: !!v?.start, b: !!v?.end, k: kind, s: (req as GenRequest).style }) : ''
  useEffect(() => {
    if (!req || req.provider === 'codex') return setInfo(null)
    let alive = true
    // another model or setting: the old price is not shown as this one's
    setInfo(null)
    setBusy(true)
    const t = setTimeout(() => {
      void studio.ai
        .estimate({ ...req, prompt: req.prompt || 'estimate', references: [] } as never, kind)
        .then((r) => alive && setInfo(r))
        .catch(() => alive && setInfo(null))
        .finally(() => alive && setBusy(false))
    }, 700)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!req || req.provider === 'codex') return null
  // the most auto could cost is not a shortage
  const low = info?.cost != null && info.balance != null && info.cost > info.balance && info.certainty !== 'max'
  if (info?.problem)
    return (
      <span className="row tiny" style={{ gap: 4, color: 'var(--warning)' }} data-testid={`credit-${kind}`}>
        <Coins size={11} />
        {info.problem}
      </span>
    )
  return (
    <span className="row tiny" style={{ gap: 4, color: low ? 'var(--danger)' : 'var(--text-3)', flexWrap: 'wrap' }} data-testid={`credit-${kind}`} title="서비스에 미리 물어본 값이에요 (실제로 만들지 않고, 크레딧도 쓰지 않아요)">
      {busy ? <Loader2 size={11} className="spin" /> : <Coins size={11} />}
      {info?.cost != null
        ? info.certainty === 'max'
          ? `최대 ${fmt(info.cost)} 크레딧 (자동: 만들 때 모델을 골라요)`
          : `예상 ${fmt(info.cost)} 크레딧${info.certainty === 'variable' ? ' (달라질 수 있음)' : ''}`
        : busy
          ? '예상 크레딧 확인 중'
          : '예상 크레딧 모름'}
      {info?.balance != null && ` · 남은 ${fmt(info.balance)}`}
      {low && ' · 크레딧이 모자라요'}
      {info?.adjusted?.length ? ` · ${info.adjusted.join(', ')}` : ''}
    </span>
  )
}
