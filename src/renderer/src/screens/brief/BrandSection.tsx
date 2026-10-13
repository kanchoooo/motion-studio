import { useEffect, useState } from 'react'
import { Palette, Plus, Trash2, Upload, X } from 'lucide-react'
import type { BrandPreset, Brief } from '@shared/brief'
import { FontSelect } from '../../components/FontSelect'
import { ColorField, Field, Modal } from '../../components/ui'
import { studio, useStore } from '../../store'

const blank = (): Omit<BrandPreset, 'id'> & { id?: string } => ({ name: '', colors: [{ name: '메인', hex: '#ff6a3d' }], fonts: {}, notes: '' })

/** brand kit picker on the tone page: apply a saved kit or save this brief as one */
export function BrandSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const { project, toast } = useStore()
  const [brands, setBrands] = useState<BrandPreset[]>([])
  const [editing, setEditing] = useState<(Omit<BrandPreset, 'id'> & { id?: string }) | null>(null)
  const [logoSource, setLogoSource] = useState<string | undefined>()
  const load = () => void studio.brands.list().then(setBrands)
  useEffect(load, [])

  const apply = async (b: BrandPreset) => {
    let next: Brief = { ...brief, client: brief.client || b.name, brand: { id: b.id, name: b.name, colors: b.colors, fonts: b.fonts, notes: b.notes } }
    if (b.logo && !brief.assets.some((a) => a.kind === 'logo')) {
      const [logo] = await studio.projects.importAssets(project!.meta.id, [b.logo])
      if (logo) next = { ...next, assets: [...next.assets, { ...logo, kind: 'logo', transform: 'none', required: true, note: `${b.name} 로고 (브랜드 프리셋)` }] }
    }
    onChange(next)
    toast(`"${b.name}" 브랜드를 적용했어요`, 'success')
  }

  const fromBrief = () => {
    const hexes = [...new Set(brief.tone.match(/#[0-9a-fA-F]{6}\b/g) ?? [])]
    const fonts = brief.texts.map((t) => t.style.fontFamily).filter(Boolean) as string[]
    const logo = brief.assets.find((a) => a.kind === 'logo')
    setLogoSource(logo ? `${project!.path}/composition/${logo.file}` : undefined)
    setEditing({ name: brief.client || brief.title, colors: hexes.length ? hexes.map((hex, i) => ({ name: `컬러 ${i + 1}`, hex })) : blank().colors, fonts: { headline: fonts[0], body: fonts[1] ?? fonts[0] }, notes: brief.tone })
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row">
        <Palette size={15} color="var(--text-2)" />
        <span className="grow" style={{ fontWeight: 650 }}>브랜드 프리셋</span>
        {brief.brand && (
          <span className="badge accent">
            적용됨: {brief.brand.name}
            <button className="icon-btn" title="브랜드 적용 풀기 (넣은 로고 소재는 그대로 둬요)" style={{ width: 16, height: 16, marginLeft: 2 }} onClick={() => onChange({ ...brief, brand: undefined })}>
              <X size={11} />
            </button>
          </span>
        )}
      </div>
      <div className="small muted" style={{ margin: '6px 0 10px' }}>광고주별 컬러·폰트·로고를 저장해 두고 새 프로젝트에 바로 적용해요. 모든 프로젝트에서 같이 써요.</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {brands.map((b) => (
          <div key={b.id} className="row card" style={{ padding: '4px 4px 4px 10px', gap: 6, background: 'var(--surface-2)' }}>
            <div className="row" style={{ gap: 2 }}>
              {b.colors.slice(0, 4).map((c) => (
                <span key={c.hex + c.name} title={`${c.name} ${c.hex}`} style={{ width: 12, height: 12, borderRadius: 3, background: c.hex, border: '1px solid var(--border)' }} />
              ))}
            </div>
            <span className="small" style={{ fontWeight: 600 }}>{b.name}</span>
            {brief.brand?.id === b.id ? (
              <button className="btn sm" title="다시 누르면 적용을 풀어요" onClick={() => onChange({ ...brief, brand: undefined })}>
                적용됨
              </button>
            ) : (
              <button className="btn sm primary" onClick={() => apply(b)}>
                적용
              </button>
            )}
            <button className="btn sm ghost" onClick={() => { setLogoSource(undefined); setEditing(b) }}>
              편집
            </button>
          </div>
        ))}
        <button className="btn sm" onClick={() => { setLogoSource(undefined); setEditing(blank()) }}>
          <Plus size={13} />새 브랜드
        </button>
        <button className="btn sm ghost" onClick={fromBrief}>
          이 브리프로 브랜드 만들기
        </button>
      </div>

      {editing && (
        <Modal
          title={editing.id ? '브랜드 편집' : '새 브랜드'}
          onClose={() => setEditing(null)}
          width={600}
          footer={
            <>
              {editing.id && (
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!confirm(`"${editing.name}" 브랜드를 삭제할까요?`)) return
                    await studio.brands.remove(editing.id!)
                    setEditing(null)
                    load()
                  }}
                >
                  <Trash2 size={14} />
                  삭제
                </button>
              )}
              <div className="grow" />
              <button className="btn" onClick={() => setEditing(null)}>
                취소
              </button>
              <button
                className="btn primary"
                disabled={!editing.name.trim()}
                onClick={async () => {
                  await studio.brands.save(editing, logoSource)
                  setEditing(null)
                  load()
                  toast('브랜드를 저장했어요', 'success')
                }}
              >
                저장
              </button>
            </>
          }
        >
          <Field label="브랜드 이름">
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="예: 모션커피" />
          </Field>
          <Field label="브랜드 컬러">
            <div className="col" style={{ gap: 6 }}>
              {editing.colors.map((c, i) => (
                <div key={i} className="row">
                  <input className="input" style={{ width: 120 }} value={c.name} onChange={(e) => setEditing({ ...editing, colors: editing.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <div className="grow">
                    <ColorField value={c.hex} onChange={(hex) => setEditing({ ...editing, colors: editing.colors.map((x, j) => (j === i ? { ...x, hex } : x)) })} />
                  </div>
                  <button className="icon-btn" onClick={() => setEditing({ ...editing, colors: editing.colors.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ ...editing, colors: [...editing.colors, { name: `컬러 ${editing.colors.length + 1}`, hex: '#000000' }] })}>
                <Plus size={13} />
                컬러 추가
              </button>
            </div>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="헤드라인 폰트">
              <FontSelect value={editing.fonts.headline} onChange={(headline) => setEditing({ ...editing, fonts: { ...editing.fonts, headline } })} />
            </Field>
            <Field label="본문 폰트">
              <FontSelect value={editing.fonts.body} onChange={(body) => setEditing({ ...editing, fonts: { ...editing.fonts, body } })} />
            </Field>
          </div>
          <Field label="로고" hint={logoSource ? `새 로고: ${logoSource.split(/[\\/]/).pop()}` : editing.logo ? '저장된 로고가 있어요' : '로고 파일을 넣으면 적용할 때 소재로 자동 추가돼요'}>
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                const [f] = await studio.app.pickFiles('assets')
                if (f) setLogoSource(f)
              }}
            >
              <Upload size={13} />
              로고 파일 선택
            </button>
          </Field>
          <Field label="브랜드 메모 (톤·금지 사항 등)">
            <textarea className="textarea" rows={4} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
