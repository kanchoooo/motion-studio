// 소재 > AI 웹 수집: Claude looks the advertised company / brand up on the web and lists
// logos, images, brand colours, facts and copy with their sources. The designer throws
// away what they do not want (✕, at once); the rest goes into the brief in one step.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, Globe, Loader2, Palette, Quote, Search, Square, X } from 'lucide-react'
import type { CollectItem, CollectResultInfo } from '@shared/api'
import type { Asset, Brief } from '@shared/brief'
import { studio, useStore } from '../../store'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const TYPE_LABEL: Record<CollectItem['type'], string> = { logo: '로고', image: '이미지', color: '브랜드 색', copy: '카피', fact: '핵심 사실' }

export function WebCollector({ brief, onKeep }: { brief: Brief; onKeep(r: { assets: Asset[]; colors: { name: string; hex: string }[]; notes: string[] }, brand: string): void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [open, setOpen] = useState(false)
  const [brand, setBrand] = useState(brief.client || brief.brand?.name || '')
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<CollectResultInfo | null>(null)
  const [base, setBase] = useState('')
  const [adding, setAdding] = useState(false)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void studio.ai.collected(pid).then((r) => {
      setResult(r)
      if (r?.items.length) setOpen(true)
    })
    void studio.projects.fileUrl(pid, '').then(setBase)
    return studio.ai.onCollect((e) => e.projectId === pid && setLines((l) => [...l, e.line].slice(-40)))
  }, [pid])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [lines.length])

  const run = async () => {
    if (busy) return
    setBusy(true)
    setLines([])
    try {
      const r = await studio.ai.collect(pid, { brand, focus })
      setResult(r)
      if (!r.items.length) toast('쓸 만한 자료를 찾지 못했어요. 이름을 정확히 적거나 방향을 바꿔 보세요.', 'info')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const drop = async (id: string) => setResult(await studio.ai.dropCollected(pid, [id]))
  const keepAll = async () => {
    if (!result?.items.length) return
    setAdding(true)
    try {
      const r = await studio.ai.keepCollected(pid, result.items.map((x) => x.id))
      onKeep(r, result.query.brand)
      setResult(r.left)
      toast(`소재에 넣었어요 · 이미지 ${r.assets.length}개${r.colors.length ? ` · 색 ${r.colors.length}개` : ''}${r.notes.length ? ` · 메모 ${r.notes.length}줄` : ''}`, 'success')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setAdding(false)
    }
  }

  const items = result?.items ?? []
  const pictures = items.filter((x) => x.type === 'logo' || x.type === 'image')
  const colors = items.filter((x) => x.type === 'color')
  const texts = items.filter((x) => x.type === 'copy' || x.type === 'fact')

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }} data-testid="web-collector">
      <button className="row" style={{ width: '100%', padding: '12px 14px', border: 'none', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--text)' }} onClick={() => setOpen(!open)} data-testid="collect-toggle" aria-expanded={open}>
        <Globe size={15} color="var(--accent)" />
        <span style={{ fontWeight: 650, textAlign: 'left' }} className="grow">
          AI 웹 수집
        </span>
        {!open && items.length > 0 && <span className="badge accent">자료 {items.length}개</span>}
        <span className="tiny muted">Claude가 브랜드 자료를 웹에서 모아 정리해요</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <div className="col" style={{ gap: 12, padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '10px 12px', alignItems: 'center' }}>
            <span className="small muted">회사·브랜드</span>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="예) 모션커피" data-testid="collect-brand" />
            <span className="small muted">방향 (선택)</span>
            <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="예) 새로 나온 앱 주문 서비스, 로고와 제품 사진 위주" data-testid="collect-focus" />
          </div>
          <div className="row">
            <span className="tiny faint grow">공식 사이트·보도자료를 먼저 찾아요. 1~3분쯤 걸려요. 모은 이미지는 쓰기 전에 사용 권한을 꼭 확인해 주세요.</span>
            {busy ? (
              <button className="btn" onClick={() => void studio.ai.cancelCollect()}>
                <Square size={12} />
                멈추기
              </button>
            ) : (
              <button className="btn primary" disabled={!brand.trim()} onClick={() => void run()} data-testid="collect-run">
                <Search size={14} />
                {items.length ? '다시 모으기' : '모으기'}
              </button>
            )}
          </div>
          {(busy || lines.length > 0) && (
            <div ref={log} className="col tiny muted" style={{ gap: 2, maxHeight: 120, overflow: 'auto', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', lineHeight: 1.6 }} data-testid="collect-progress">
              {lines.map((l, i) => (
                <span key={i} className="ellipsis">
                  {l}
                </span>
              ))}
              {busy && (
                <span className="row" style={{ gap: 6 }}>
                  <Loader2 size={11} className="spin" />
                  찾는 중…
                </span>
              )}
            </div>
          )}

          {result && items.length > 0 && (
            <>
              {result.summary && <div className="small" style={{ lineHeight: 1.6 }}>{result.summary}</div>}
              <div className="row tiny muted">
                <span className="grow">필요 없는 자료는 ✕로 바로 버리세요. 남은 것을 한 번에 소재에 넣어요.</span>
              </div>
              {pictures.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {pictures.map((x) => (
                    <div key={x.id} className="card" style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }} data-testid="collect-item">
                      <div style={{ aspectRatio: '4 / 3', background: 'var(--canvas)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {base && <img src={`${base}${x.file}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
                      </div>
                      <div className="row tiny" style={{ gap: 4 }}>
                        <span className="badge">{TYPE_LABEL[x.type]}</span>
                        <span className="ellipsis grow" title={x.title}>{x.title}</span>
                      </div>
                      <Source url={x.source} />
                      <DropButton onClick={() => void drop(x.id)} />
                    </div>
                  ))}
                </div>
              )}
              {colors.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {colors.map((x) => (
                    <div key={x.id} className="card row" style={{ padding: '6px 8px', gap: 8, position: 'relative', paddingRight: 30 }} data-testid="collect-item">
                      <span style={{ width: 22, height: 22, borderRadius: 5, background: x.hex, border: '1px solid var(--border)' }} />
                      <span className="col" style={{ gap: 0 }}>
                        <span className="small">{x.title}</span>
                        <span className="tiny muted mono">{x.hex}</span>
                      </span>
                      <DropButton onClick={() => void drop(x.id)} />
                    </div>
                  ))}
                </div>
              )}
              {texts.length > 0 && (
                <div className="col" style={{ gap: 6 }}>
                  {texts.map((x) => (
                    <div key={x.id} className="card row" style={{ padding: '8px 10px', gap: 8, alignItems: 'flex-start', position: 'relative', paddingRight: 34 }} data-testid="collect-item">
                      {x.type === 'copy' ? <Quote size={13} color="var(--accent)" style={{ marginTop: 2 }} /> : <Palette size={13} color="var(--text-3)" style={{ marginTop: 2, visibility: 'hidden' }} />}
                      <div className="col grow" style={{ gap: 2 }}>
                        <span className="small" style={{ lineHeight: 1.5 }}>
                          <b className="tiny muted" style={{ marginRight: 6 }}>{TYPE_LABEL[x.type]}</b>
                          {x.text}
                        </span>
                        <Source url={x.source} />
                      </div>
                      <DropButton onClick={() => void drop(x.id)} />
                    </div>
                  ))}
                </div>
              )}
              <div className="row">
                <span className="tiny faint grow">이미지·로고는 소재로, 색은 브랜드 색으로, 카피·사실은 브랜드 메모로 들어가요.</span>
                <button className="btn primary" disabled={adding} onClick={() => void keepAll()} data-testid="collect-keep">
                  {adding ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  남은 {items.length}개 소재에 넣기
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DropButton({ onClick }: { onClick(): void }) {
  return (
    <button className="icon-btn" title="버리기" onClick={onClick} style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, background: 'var(--surface)' }} data-testid="collect-drop">
      <X size={13} />
    </button>
  )
}

function Source({ url }: { url?: string }) {
  if (!url) return null
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep as is */
  }
  return (
    <button className="row tiny faint" style={{ gap: 3, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-3)' }} title={url} onClick={() => void studio.app.openExternal(url)}>
      <ExternalLink size={10} />
      <span className="ellipsis">{host}</span>
    </button>
  )
}
