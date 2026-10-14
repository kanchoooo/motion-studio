import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { FontFamily } from '@shared/api'
import { studio, useStore } from '../store'

/** the open project's downloaded web fonts, loaded into the app so they preview in their own face */
function useProjectFonts(open: boolean): FontFamily[] {
  const { project } = useStore()
  const [list, setList] = useState<FontFamily[]>([])
  useEffect(() => {
    if (!project || !open) return
    const pid = project.meta.id
    void studio.projects.webFonts(pid).then(async (w) => {
      setList(w.map((f) => ({ family: f.family, hangul: true, weights: f.weights, faces: [] })))
      if (!w.length) return
      const href = await studio.projects.fileUrl(pid, 'composition/fonts/web-fonts.css')
      const id = `ms-web-fonts-${pid}`
      const old = document.getElementById(id) as HTMLLinkElement | null
      if (old?.href === href) return
      old?.remove()
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = `${href}?v=${w.map((f) => f.family + f.weights.join('')).join('|')}`
      document.head.appendChild(link)
    })
  }, [project, open])
  return list
}

/** searchable font picker (the project's web fonts first, then system fonts) that previews each family in its own face */
export function FontSelect({ value, onChange, placeholder = '폰트 선택' }: { value?: string; onChange: (family: string) => void; placeholder?: string }) {
  const { fonts: system, loadFonts } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [koOnly, setKoOnly] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const own = useProjectFonts(open || !!value)
  const fonts = useMemo(() => [...own, ...system.filter((f) => !own.some((o) => o.family === f.family))], [own, system])

  useEffect(() => {
    if (open) void loadFonts()
  }, [open, loadFonts])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return fonts.filter((f) => (!koOnly || f.hangul) && (!s || f.family.toLowerCase().includes(s) || f.familyKo?.toLowerCase().includes(s))).slice(0, 300)
  }, [fonts, q, koOnly])

  const current = fonts.find((f) => f.family === value || f.familyKo === value)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="input row" style={{ justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(!open)}>
        <span className="ellipsis" style={{ fontFamily: value ? `"${value}", var(--font)` : undefined, color: value ? undefined : 'var(--text-3)' }}>
          {current ? current.familyKo ?? current.family : value || placeholder}
        </span>
        <ChevronDown size={14} color="var(--text-3)" />
      </button>
      {open && (
        <div className="menu fade-in" style={{ left: 0, right: 0, top: 36, padding: 6, maxHeight: 360, display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ padding: '2px 2px 6px' }}>
            <div className="row input" style={{ height: 30, padding: '0 8px', gap: 6 }}>
              <Search size={13} color="var(--text-3)" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="폰트 이름 검색" style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, minWidth: 0 }} />
            </div>
            <label className="row tiny muted" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={koOnly} onChange={(e) => setKoOnly(e.target.checked)} />
              한글만
            </label>
          </div>
          <div style={{ overflow: 'auto' }}>
            {!fonts.length && <div className="small muted" style={{ padding: 10 }}>폰트를 불러오고 있어요…</div>}
            {list.map((f) => (
              <button
                key={f.family}
                type="button"
                onClick={() => {
                  onChange(f.family)
                  setOpen(false)
                }}
                style={{ height: 'auto', padding: '7px 10px', flexDirection: 'column', alignItems: 'flex-start', gap: 1, background: f.family === value ? 'var(--accent-soft)' : undefined }}
              >
                <span style={{ fontFamily: `"${f.family}"`, fontSize: 15 }}>{f.familyKo ?? f.family} · 가나다 Aa</span>
                <span className="tiny faint">
                  {own.some((o) => o.family === f.family) ? '이 프로젝트 폰트 · ' : ''}
                  {f.familyKo ? `${f.family} · ` : ''}
                  굵기 {f.weights.length}종
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
