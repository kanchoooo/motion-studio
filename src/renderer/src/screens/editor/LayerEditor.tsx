// One layer, edited like After Effects' layer properties: every property has a stopwatch
// (keyframes at the playhead) — transform, type, the box, effects, the mask, line drawing —
// plus wiggle, loops, a number counter, Claude's own motion taken over as keyframes, a
// character's acting controls and its parts, the camera, the picture or clip it shows and
// its time (in / out). Claude made the layer; every value here is layered on top.
import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpLeft,
  BringToFront,
  CaseUpper,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crosshair,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Italic,
  Link2,
  Lock,
  Repeat,
  RotateCcw,
  SendToBack,
  Strikethrough,
  Timer,
  Trash2,
  Underline,
  Undo2,
  Unlink2,
  Unlock,
} from 'lucide-react'
import {
  CAMERA_ID,
  isSpatial,
  PROP,
  TEXT_ANIMS,
  WIGGLE_LABEL,
  WIGGLE_PROPS,
  type ElementStyle,
  type KeyProp,
  type LayerMask,
  type TextAnimPreset,
  type TextCounter,
  type WiggleProp,
} from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { FontSelect } from '../../components/FontSelect'
import { ColorField, NumberField, Segmented, Toggle } from '../../components/ui'
import { cleanError, studio, useStore } from '../../store'
import { anchorToCenter, anyNow, freeLayout, isKeyed, keyTimes, labelOf, releaseOwn, reorder, setOwnNow, setProps, snapT, takeOver, toggleKeyHere, toggleStopwatch } from './edit'
import { useEditor } from './editorStore'
import { useOverrides } from './overrides'
import { propsNow } from './player'
import { isOwn, ownTrack, propLabel, rigLabel, trackKeys, type Track } from './tracks'

const WEIGHT_NAME: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }
const BLENDS: [string, string][] = [
  ['normal', '보통'],
  ['multiply', '곱하기'],
  ['screen', '스크린'],
  ['overlay', '오버레이'],
  ['darken', '어둡게'],
  ['lighten', '밝게'],
  ['color-dodge', '색상 닷지'],
  ['color-burn', '색상 번'],
  ['hard-light', '하드 라이트'],
  ['soft-light', '소프트 라이트'],
  ['difference', '차이'],
  ['exclusion', '제외'],
  ['hue', '색조'],
  ['saturation', '채도'],
  ['color', '색상'],
  ['luminosity', '광도'],
]

function Section({ title, children, right, testid }: { title: string; children: React.ReactNode; right?: React.ReactNode; testid?: string }) {
  return (
    <div className="col" style={{ gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 6 }} data-testid={testid}>
      <div className="row">
        <div className="section-label grow">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

const LOOP_NEXT = { none: 'cycle', cycle: 'pingpong', pingpong: 'none' } as const
const LOOP_LABEL = { none: '반복 없음', cycle: '반복: 마지막 키프레임 뒤로 처음부터 다시', pingpong: '왕복: 마지막 키프레임 뒤로 거꾸로 갔다 오기' }

/** one property row: stopwatch, name, fields, keyframe navigation and the loop switch once it is keyframed */
function KeyRow({ id, label, props, children }: { id: string; label: string; props: Track[]; children: React.ReactNode }) {
  const o = useOverrides((s) => s.value?.elements[id])
  const time = useEditor((s) => s.time)
  const keyed = props.some((p) => trackKeys(o, p).length)
  const t = snapT(time)
  const onKey = props.some((p) => trackKeys(o, p).some((k) => Math.abs(k.t - t) < 1e-3))
  const times = keyed ? keyTimes(id, props) : []
  const own = props.every(isOwn)
  const loop = (o?.loops?.[props[0]] ?? 'none') as keyof typeof LOOP_NEXT
  const go = (dir: -1 | 1) => {
    const to = dir < 0 ? [...times].reverse().find((x) => x < t - 1e-3) : times.find((x) => x > t + 1e-3)
    if (to == null) return
    const { player } = useEditor.getState()
    player?.pause()
    player?.seek(to)
    useEditor.setState({ time: to })
  }
  return (
    <div className="key-row" data-keyrow={props.join('+')}>
      {props.length && !own ? (
        <button className={`icon-btn stopwatch${keyed ? ' on' : ''}`} title={keyed ? '키프레임 끄기 (지금 값으로 고정)' : '키프레임 켜기 (스톱워치)'} onClick={() => toggleStopwatch(id, props as KeyProp[])} data-testid={`stopwatch-${props[0]}`}>
          <Timer size={12} />
        </button>
      ) : (
        <span style={{ width: 22, flex: 'none' }} />
      )}
      <span className="key-label" title={label}>
        {label}
      </span>
      <div className="key-fields">{children}</div>
      {keyed && (
        <div className="row" style={{ gap: 0 }}>
          <button className="icon-btn" style={{ width: 18 }} title="이전 키프레임 (J)" onClick={() => go(-1)} disabled={!times.some((x) => x < t - 1e-3)}>
            <ChevronLeft size={12} />
          </button>
          <button className={`icon-btn key-here${onKey ? ' on' : ''}`} style={{ width: 18 }} title={onKey ? '이 키프레임 지우기' : '지금 시점에 키프레임 추가'} onClick={() => toggleKeyHere(id, props)} data-testid={`key-here-${props[0]}`}>
            <Diamond size={11} />
          </button>
          <button className="icon-btn" style={{ width: 18 }} title="다음 키프레임 (K)" onClick={() => go(1)} disabled={!times.some((x) => x > t + 1e-3)}>
            <ChevronRight size={12} />
          </button>
          <button
            className={`icon-btn${loop !== 'none' ? ' active' : ''}`}
            style={{ width: 20 }}
            title={`${LOOP_LABEL[loop]} (눌러서 바꾸기)`}
            onClick={() => {
              const next = LOOP_NEXT[loop]
              for (const p of props) useOverrides.getState().setLoop(id, labelOf(id), p, next === 'none' ? null : next)
            }}
            data-testid={`loop-${props[0]}`}
          >
            <Repeat size={11} />
            {loop === 'pingpong' && <span className="tiny">↔</span>}
          </button>
        </div>
      )}
    </div>
  )
}

/** a property's field: a number (shown scaled: opacity in %) or a colour; editing sets a key when keyframed */
function PropField({ id, p, label, onValue }: { id: string; p: KeyProp; label?: string; onValue?: (v: number | string) => void }) {
  useOverrides((s) => s.value?.elements[id])
  useEditor((s) => s.time)
  const def = PROP[p]
  const v = anyNow(id, p)
  const set = onValue ?? ((value: number | string) => setProps([{ id, values: { [p]: value } }], [p]))
  if (def.kind === 'color') return <ColorField value={String(v)} onChange={(c) => set(c)} />
  const k = def.scale ?? 1
  const prec = def.precision ?? 0
  return (
    <NumberField
      title={def.label}
      label={label}
      unit={def.shownUnit}
      step={def.step ?? (prec >= 2 ? 0.05 : 1)}
      precision={prec}
      min={def.min != null ? def.min * k : undefined}
      max={def.max != null ? def.max * k : undefined}
      value={Math.round(Number(v) * k * 10 ** prec) / 10 ** prec}
      onChange={(n) => set(n / k)}
    />
  )
}

/** a property with its stopwatch */
function Prop({ id, p, label }: { id: string; p: KeyProp; label?: string }) {
  return (
    <KeyRow id={id} label={label ?? PROP[p].label} props={[p]}>
      <PropField id={id} p={p} />
    </KeyRow>
  )
}

export function LayerEditor({ id }: { id: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))
  const { value: ov, patchElement, resetElement, setLocked, updateLayer, remove, duplicate, restore } = useOverrides()
  if (!el || !ov) return null
  const o = ov.elements[id] ?? {}
  const layer = ov.layers.find((l) => l.id === id)
  const label = labelOf(id)
  const locked = !!o.locked
  const isText = el.type === 'text'
  const isPart = el.type === 'part'
  const isCamera = id === CAMERA_ID

  return (
    <div className="col" style={{ gap: 6 }} data-testid="layer-editor">
      <LayerHeader id={id} label={label} />
      {o.deleted && (
        <div className="row tiny" style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--surface-3)' }}>
          <span className="grow">삭제한 레이어예요</span>
          <button className="btn sm" onClick={() => restore(id, label)}>
            되살리기
          </button>
        </div>
      )}
      {locked && (
        <div className="row tiny" style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)' }} data-testid="layer-locked">
          <Lock size={11} />
          <span className="grow">잠긴 레이어예요. Claude도 이 레이어는 바꾸지 않아요.</span>
          <button className="btn ghost sm" style={{ height: 22 }} onClick={() => setLocked([{ id, label }], false)}>
            <Unlock size={11} />
            잠금 해제
          </button>
        </div>
      )}
      {isPart && <div className="tiny muted">캐릭터 부위예요. 여기서 준 움직임은 Claude가 만든 연기 위에 더해지고, 안쪽 부위도 함께 따라와요.</div>}
      {isCamera && <div className="tiny muted">카메라는 화면 전체를 옮기고 키우고 돌려요. 흔들림으로 카메라 흔들기도 할 수 있어요.</div>}
      <fieldset className="layer-fieldset" disabled={locked} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {!isPart && !isCamera && (
          <div className="row" style={{ gap: 4, marginBottom: 4 }}>
            <button
              className="btn sm"
              title="복제 (⌘D)"
              onClick={() => {
                const ids = duplicate([{ id, label, copyOf: el.copyOf, stack: el.stack }])
                if (ids[0]) useEditor.setState({ selected: ids[0], selection: ids })
              }}
            >
              <Copy size={12} />
              복제
            </button>
            <button
              className="btn sm"
              title="삭제 (Delete)"
              onClick={() => {
                remove([{ id, label }])
                useEditor.getState().select(null)
              }}
              data-testid="layer-delete"
            >
              <Trash2 size={12} />
              삭제
            </button>
            <button className="icon-btn" title="맨 앞으로 (⇧⌘])" onClick={() => reorder([id], 'front')}>
              <BringToFront size={14} />
            </button>
            <button className="icon-btn" title="맨 뒤로 (⇧⌘[)" onClick={() => reorder([id], 'back')}>
              <SendToBack size={14} />
            </button>
            <div className="grow" />
            {Object.keys(o).some((k) => !['locked', 'label'].includes(k)) && (
              <button className="btn ghost sm" title="이 레이어의 직접 수정을 모두 되돌려요" onClick={() => resetElement(id, label)}>
                <RotateCcw size={11} />
                초기화
              </button>
            )}
          </div>
        )}

        {layer && (
          <Section title="레이어 상자">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <NumberField label="X" unit="px" value={layer.x} onChange={(x) => updateLayer(id, { x }, `${label}: 상자 위치`)} />
              <NumberField label="Y" unit="px" value={layer.y} onChange={(y) => updateLayer(id, { y }, `${label}: 상자 위치`)} />
              <NumberField label="폭" unit="px" value={layer.w} min={1} onChange={(w) => updateLayer(id, { w }, `${label}: 상자 크기`)} />
              {layer.kind !== 'text' && <NumberField label="높이" unit="px" value={layer.h} min={1} onChange={(h) => updateLayer(id, { h }, `${label}: 상자 크기`)} />}
            </div>
            {layer.kind === 'shape' && (
              <Segmented full value={layer.shape ?? 'rect'} onChange={(shape) => updateLayer(id, { shape }, `${label}: 모양`)} options={[{ value: 'rect', label: '사각형' }, { value: 'ellipse', label: '원' }]} />
            )}
            {(layer.kind === 'image' || layer.kind === 'video') && (
              <Segmented full value={layer.fit ?? 'cover'} onChange={(fit) => updateLayer(id, { fit }, `${label}: 맞춤`)} options={[{ value: 'cover', label: '채우기' }, { value: 'contain', label: '맞추기' }, { value: 'fill', label: '늘리기' }]} />
            )}
            {layer.kind === 'video' && (
              <div className="row small">
                <Toggle on={layer.muted === false} onChange={(on) => updateLayer(id, { muted: !on }, `${label}: 소리 ${on ? '켜기' : '끄기'}`)} />
                <span className="grow">영상 소리</span>
                <NumberField label="시작" unit="초" value={layer.mediaStart ?? 0} min={0} step={0.1} precision={2} onChange={(mediaStart) => updateLayer(id, { mediaStart }, `${label}: 영상 시작 지점`)} />
              </div>
            )}
          </Section>
        )}

        <TransformSection id={id} />
        {el.transformable && <WiggleSection id={id} />}
        {!!el.rig?.length && <CharacterSection id={id} />}
        {!isPart && !isCamera && <ClaudeMotionSection id={id} />}
        {isText && <TextSection id={id} />}
        {!isPart && !isCamera && <ShapeSection id={id} />}
        {el.transformable && !isPart && !isCamera && <EffectsSection id={id} />}
        {el.transformable && !isPart && !isCamera && <MaskSection id={id} />}
        {!isPart && !isCamera && <TrimSection id={id} />}
        {!isPart && !isCamera && el.transformable && <LinkSection id={id} />}
        {!isPart && !isCamera && (el.src !== undefined || layer?.kind === 'image' || layer?.kind === 'video') && <MediaSection id={id} />}
        {!isCamera && <TimeSection id={id} />}
      </fieldset>
    </div>
  )
}

function TransformSection({ id }: { id: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  useEditor((s) => s.time)
  const [linked, setLinked] = useState(true)
  // X / Y apart when their keyframes are (After Effects' "Separate Dimensions")
  const xs = trackKeys(o, 'x').map((k) => k.t.toFixed(3)).join()
  const ys = trackKeys(o, 'y').map((k) => k.t.toFixed(3)).join()
  const [sep, setSep] = useState(xs !== ys)
  const isCamera = id === CAMERA_ID
  const isPart = el.type === 'part'
  const v = (p: KeyProp) => Number(anyNow(id, p))
  const scaleRow = (
    <KeyRow id={id} label={isCamera ? '줌' : '크기'} props={['scaleX', 'scaleY']}>
      <NumberField title="가로 크기" label="W" unit="%" value={Math.round(v('scaleX') * 1000) / 10} precision={1} onChange={(p) => setProps([{ id, values: linked ? { scaleX: p / 100, scaleY: (p / 100) * (v('scaleY') / (v('scaleX') || 1)) } : { scaleX: p / 100 } }], ['scaleX'])} />
      <NumberField title="세로 크기" label="H" unit="%" value={Math.round(v('scaleY') * 1000) / 10} precision={1} onChange={(p) => setProps([{ id, values: linked ? { scaleY: p / 100, scaleX: (p / 100) * (v('scaleX') / (v('scaleY') || 1)) } : { scaleY: p / 100 } }], ['scaleY'])} />
      <button className={`icon-btn${linked ? ' active' : ''}`} style={{ width: 20 }} title={linked ? '비율 고정 (풀기)' : '비율 고정'} onClick={() => setLinked(!linked)}>
        {linked ? <Link2 size={12} /> : <Unlink2 size={12} />}
      </button>
    </KeyRow>
  )
  return (
    <Section
      title={isCamera ? '카메라' : '변형'}
      right={
        el.movable && (
          <button className={`btn ghost sm${sep ? ' active' : ''}`} style={{ height: 22 }} title="위치의 가로·세로를 따로 키프레임" onClick={() => setSep(!sep)} data-testid="sep-xy">
            X/Y 따로
          </button>
        )
      }
    >
      {!el.movable && <div className="tiny" style={{ color: 'var(--warning)' }}>화면에 붙어 있는(sticky) 레이어라 옮길 수 없어요. 옮기려면 Claude에게 말해 주세요.</div>}
      {el.movable && !el.transformable && <FreeLayoutHint id={id} />}
      {el.transformable && !isPart && !isCamera && (
        <KeyRow id={id} label="기준점" props={['anchorX', 'anchorY']}>
          <PropField id={id} p="anchorX" label="X" />
          <PropField id={id} p="anchorY" label="Y" />
          <button className="icon-btn" style={{ width: 20, flex: 'none' }} title="기준점을 레이어 가운데로 (화면에서 레이어는 그대로예요)" disabled={!v('anchorX') && !v('anchorY')} onClick={() => anchorToCenter(id)} data-testid="anchor-center">
            <Crosshair size={12} />
          </button>
        </KeyRow>
      )}
      {el.movable &&
        (sep ? (
          <>
            <KeyRow id={id} label="가로 위치" props={['x']}>
              <PropField id={id} p="x" label="X" />
            </KeyRow>
            <KeyRow id={id} label="세로 위치" props={['y']}>
              <PropField id={id} p="y" label="Y" />
            </KeyRow>
          </>
        ) : (
          <KeyRow id={id} label={isCamera ? '이동' : '위치'} props={['x', 'y']}>
            {/* one property, like After Effects' position: a key here keys both */}
            <NumberField title="가로 이동 (캔버스에서 끌어도 돼요)" label="X" value={Math.round(v('x'))} onChange={(x) => setProps([{ id, values: { x, y: v('y') } }], ['x'])} />
            <NumberField title="세로 이동" label="Y" value={Math.round(v('y'))} onChange={(y) => setProps([{ id, values: { x: v('x'), y } }], ['y'])} />
          </KeyRow>
        ))}
      {el.movable && trackKeys(o, 'x').length > 1 && xs === ys && (
        <div className="row tiny" style={{ gap: 6 }}>
          <span className="muted grow">움직임 경로</span>
          <Segmented
            value={isSpatial(o) ? 'curve' : 'line'}
            onChange={(v) => useOverrides.getState().setPathCurve(id, labelOf(id), v === 'curve')}
            options={[
              { value: 'line', label: '직선' },
              { value: 'curve', label: '곡선' },
            ]}
          />
        </div>
      )}
      {el.transformable && (
        <>
          {scaleRow}
          <Prop id={id} p="rotate" />
          {!isPart && !isCamera && (
            <>
              <Prop id={id} p="rotateX" label="3D X" />
              <Prop id={id} p="rotateY" label="3D Y" />
            </>
          )}
          {!isCamera && <Prop id={id} p="opacity" />}
        </>
      )}
    </Section>
  )
}

/** a layer laid out by its group (flex, grid…): only moves until the group is set free */
function FreeLayoutHint({ id }: { id: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const [busy, setBusy] = useState(false)
  return (
    <div className="row tiny" style={{ gap: 6 }} data-testid="flow-hint">
      <span className="muted grow">{el.parent ? '그룹' : '화면'} 안에 줄지어 놓인 레이어라 지금은 위치만 옮길 수 있어요. 자유 배치로 바꾸면 크기·회전·효과도 쓸 수 있어요(화면은 그대로예요).</span>
      {el.movable && (
        <button
          className="btn sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void freeLayout(id).finally(() => setBusy(false))
          }}
          data-testid="free-layout"
        >
          자유 배치로 바꾸기
        </button>
      )}
    </div>
  )
}

function WiggleSection({ id }: { id: string }) {
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const { setWiggle } = useOverrides()
  const label = labelOf(id)
  const isCamera = id === CAMERA_ID
  const props = WIGGLE_PROPS.filter((p) => !(isCamera && p === 'opacity') && !(el.type === 'part' && p === 'opacity'))
  const unit: Record<WiggleProp, string> = { x: 'px', y: 'px', rotate: '°', scale: '%', opacity: '' }
  const def: Record<WiggleProp, number> = { x: 12, y: 12, rotate: 4, scale: 4, opacity: 0.5 }
  return (
    <Section title={isCamera ? '흔들림 (카메라 흔들기)' : '흔들기'} testid="wiggle">
      <div className="tiny muted">정해진 세기 안에서 무작위로 흔들려요. 렌더할 때마다 같은 모양이에요.</div>
      {props.map((p) => {
        const w = o.wiggle?.[p]
        return (
          <div key={p} className="row small" style={{ gap: 6 }}>
            <Toggle on={!!w} onChange={(on) => setWiggle(id, label, p, on ? { freq: 3, amount: def[p] } : null)} />
            <span style={{ width: 44 }}>{WIGGLE_LABEL[p]}</span>
            {w && (
              <>
                <NumberField title="1초에 몇 번" label="빈도" unit="회" min={0.1} max={30} step={0.5} precision={1} value={w.freq} onChange={(freq) => setWiggle(id, label, p, { ...w, freq })} />
                <NumberField title="얼마나 크게" label="세기" unit={unit[p]} min={0} step={p === 'opacity' ? 0.05 : 1} precision={p === 'opacity' ? 2 : 0} value={w.amount} onChange={(amount) => setWiggle(id, label, p, { ...w, amount })} />
              </>
            )}
          </div>
        )
      })}
    </Section>
  )
}

/** a debounced read of GSAP properties at the playhead (values of Claude's motion) */
function usePropsNow(id: string, props: string[]): Record<string, number | string> {
  const time = useEditor((s) => s.time)
  const player = useEditor((s) => s.player)
  const ready = useEditor((s) => s.ready)
  const own = useOverrides((s) => s.value?.elements[id]?.own)
  const [vals, setVals] = useState<Record<string, number | string>>({})
  const key = props.join('|')
  useEffect(() => {
    if (!ready || !props.length) return
    let live = true
    const timer = setTimeout(() => void propsNow(player, id, props).then((v) => live && setVals(v)), 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [time, player, ready, key, own, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return vals
}

function fmtVal(v: number | string | undefined) {
  if (v === undefined) return '–'
  if (typeof v === 'number') return String(Math.round(v * 100) / 100)
  return v.length > 18 ? `${v.slice(0, 18)}…` : v
}

/** a value of Claude's motion: a number (or colour) field that sets a key once taken over */
function OwnField({ id, prop, value }: { id: string; prop: string; value: number | string | undefined }) {
  if (typeof value === 'string' && /^(#|rgb)/.test(value)) return <ColorField value={value.startsWith('#') ? value : value} onChange={(c) => void setOwnNow(id, prop, c)} />
  if (typeof value !== 'number') return <span className="mono tiny">{fmtVal(value)}</span>
  const small = Math.abs(value) <= 3
  return <NumberField value={value} step={small ? 0.05 : 1} precision={small ? 2 : 1} onChange={(v) => void setOwnNow(id, prop, v)} />
}

/**
 * Claude's own motion of this layer (what its code animates on it): each property can be taken
 * over as keyframes — then it is the designer's (timeline diamonds, eases, loops) — or handed back.
 */
function ClaudeMotionSection({ id }: { id: string }) {
  const motions = useEditor((s) => s.motions)
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const [busy, setBusy] = useState(false)
  const animated = [...new Set(motions.filter((m) => m.self === id).flatMap((m) => m.props.map((p) => p.name)))]
  const owned = Object.keys(o.own ?? {}).filter((p) => o.own![p]?.length && !p.startsWith('--'))
  const props = [...new Set([...animated, ...owned])].filter((p) => !p.startsWith('--'))
  const vals = usePropsNow(id, props)
  if (!props.length) return null
  const take = async (ps: string[]) => {
    setBusy(true)
    try {
      await takeOver(id, ps)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Claude가 만든 움직임"
      testid="claude-motion"
      right={
        props.some((p) => !owned.includes(p)) && (
          <button className="btn ghost sm" style={{ height: 22 }} disabled={busy} onClick={() => void take(props.filter((p) => !owned.includes(p)))} data-testid="take-all">
            <Download size={11} />
            모두 가져오기
          </button>
        )
      }
    >
      <div className="tiny muted">가져오면 Claude 움직임이 그대로 키프레임(◆)이 되어 직접 고칠 수 있어요. 돌려주면 다시 Claude 코드대로 움직여요.</div>
      {props.map((p) => {
        const mine = owned.includes(p)
        return mine ? (
          <KeyRow key={p} id={id} label={propLabel(p)} props={[ownTrack(p)]}>
            <OwnField id={id} prop={p} value={vals[p]} />
            <button className="icon-btn" title="Claude에게 돌려주기" onClick={() => releaseOwn(id, [p])} data-testid={`release-${p}`}>
              <Undo2 size={12} />
            </button>
          </KeyRow>
        ) : (
          <div key={p} className="key-row" data-claude-prop={p}>
            <span style={{ width: 22, flex: 'none' }} />
            <span className="key-label">{propLabel(p)}</span>
            <span className="key-fields mono tiny muted">{fmtVal(vals[p])}</span>
            <button className="btn ghost sm" style={{ height: 22 }} disabled={busy} onClick={() => void take([p])} data-testid={`take-${p}`}>
              가져오기
            </button>
          </div>
        )
      })}
    </Section>
  )
}

/** a character's acting controls (its rig parameters) and its parts */
function CharacterSection({ id }: { id: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  // (a selector must return what the store holds: a new array every time would re-render forever)
  const elements = useEditor((s) => s.elements)
  const parts = elements.filter((e) => e.type === 'part' && e.parent === id)
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const params = el.rig ?? []
  const vals = usePropsNow(id, params.map((p) => `--${p.name}`))
  const owned = params.filter((p) => o.own?.[`--${p.name}`]?.length).map((p) => `--${p.name}`)
  return (
    <Section
      title="캐릭터 컨트롤"
      testid="character"
      right={
        owned.length > 0 && (
          <button className="btn ghost sm" style={{ height: 22 }} title="손댄 표정·몸짓을 모두 Claude 연기로 되돌려요" onClick={() => releaseOwn(id, owned)}>
            <Undo2 size={11} />
            Claude 연기로
          </button>
        )
      }
    >
      <div className="tiny muted">표정·몸짓 값을 바꾸면 지금 시점에 키프레임이 생겨요. Claude가 만든 연기는 그대로 키프레임으로 가져와서 고쳐요.</div>
      {params.map((p) => {
        const prop = `--${p.name}`
        const mine = owned.includes(prop)
        return (
          <KeyRow key={p.name} id={id} label={rigLabel(p.name)} props={mine ? [ownTrack(prop)] : []}>
            <OwnField id={id} prop={prop} value={vals[prop] ?? p.def} />
          </KeyRow>
        )
      })}
      {parts.length > 0 && (
        <>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            부위 (캔버스에서 캐릭터를 고른 뒤 한 번 더 누르면 부위를 골라요)
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {parts.map((pt) => (
              <button key={pt.id} className="btn ghost sm" style={{ height: 22 }} onClick={() => useEditor.getState().select(pt.id)} data-testid={`part-${pt.id}`}>
                {labelOf(pt.id)}
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

/** name (double-click in the timeline too), lock, visibility, parent */
function LayerHeader({ id, label }: { id: string; label: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const o = useOverrides((s) => s.value?.elements[id])
  const { patchElement, setLocked } = useOverrides()
  const [name, setName] = useState(label)
  useEffect(() => setName(label), [label])
  return (
    <div className="row" style={{ marginBottom: 4, gap: 4 }}>
      <button className="icon-btn" title="레이어 목록 (Esc)" onClick={() => useEditor.getState().select(null)} style={{ marginLeft: -6 }}>
        ←
      </button>
      <input
        className="input grow"
        style={{ height: 28, fontWeight: 650 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== label && patchElement(id, label, { label: name.trim() }, ['label'])}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        title="레이어 이름"
        data-testid="layer-name"
      />
      {id !== CAMERA_ID && (
        <button className={`icon-btn${o?.hidden ? ' active' : ''}`} title={o?.hidden ? '보이기' : '숨기기'} onClick={() => patchElement(id, label, { hidden: !o?.hidden }, ['hidden'])}>
          {o?.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      <button className={`icon-btn${o?.locked ? ' active' : ''}`} title={o?.locked ? '잠금 해제' : '잠그기 (⌘L): Claude도 바꾸지 않아요'} onClick={() => setLocked([{ id, label }], !o?.locked)} data-testid="layer-lock">
        {o?.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      {el.parent && (
        <button className="icon-btn" title="이 레이어를 감싸는 그룹을 골라요" onClick={() => useEditor.getState().select(el.parent)}>
          <ArrowUpLeft size={14} />
        </button>
      )}
    </div>
  )
}

/** the numbers in a text, to start a counter from (12,900원 → 0 … 12900, suffix 원) */
function counterFrom(text: string, t: number): TextCounter {
  const m = text.match(/^(.*?)(-?[\d,]*\.?\d+)(.*)$/s)
  const raw = m ? m[2] : '100'
  const to = Number(raw.replace(/,/g, '')) || 100
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  return { from: 0, to, start: t, duration: 1, ease: 'power2.out', decimals, comma: raw.includes(','), prefix: m?.[1] ?? '', suffix: m?.[3] ?? '' }
}

function TextSection({ id }: { id: string }) {
  // values at the playhead: drawn again when it moves
  useEditor((s) => s.time)
  const { fonts } = useStore()
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const { value: ov, patchElement, updateLayer } = useOverrides()
  const o = ov?.elements[id] ?? {}
  const layer = ov?.layers.find((l) => l.id === id)
  const s = o.style ?? {}
  const label = labelOf(id)
  const computedFamily = el.style.fontFamily.split(',')[0].replace(/["']/g, '').trim()
  const family = s.fontFamily ?? computedFamily
  const fam = fonts.find((f) => f.family === family || f.familyKo === family)
  const current = layer ? layer.text ?? '' : o.text ?? el.text ?? ''
  const [text, setText] = useState(current)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (document.activeElement !== box.current) setText(current)
  }, [current])
  const patch = (style: ElementStyle, key: string) => patchElement(id, label, { style }, [key])
  const commitText = () => {
    if (text === current) return
    if (layer) updateLayer(id, { text }, `${label}: 문구`)
    else patchElement(id, label, { text }, ['text'])
  }
  const c = o.counter
  const setCounter = (counter: TextCounter | null) => patchElement(id, label, { counter }, ['counter'])
  return (
    <Section title="텍스트">
      <textarea
        ref={box}
        className="textarea"
        rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur()
        }}
        placeholder="문구 (⌘/Ctrl+Enter로 적용)"
        style={{ minHeight: 76, fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
        data-testid="layer-text"
      />
      {!layer && el.runs && <TextRuns id={id} runs={el.runs} />}
      <Highlights id={id} />
      <TimedText id={id} />
      <FontSelect value={family} onChange={(fontFamily) => patch({ fontFamily }, 'fontFamily')} />
      <select className="select" style={{ height: 30 }} value={s.fontWeight ?? el.style.fontWeight} onChange={(e) => patch({ fontWeight: Number(e.target.value) }, 'fontWeight')} title="굵기">
        {(fam?.weights.length ? fam.weights : [100, 200, 300, 400, 500, 600, 700, 800, 900]).map((w) => (
          <option key={w} value={w}>
            {w} {WEIGHT_NAME[w] ?? ''}
          </option>
        ))}
      </select>
      <Prop id={id} p="color" />
      <Prop id={id} p="fontSize" />
      <Prop id={id} p="letterSpacing" />
      <Prop id={id} p="lineHeight" />
      <div className="row" style={{ gap: 6 }}>
        <Segmented
          value={(s.textAlign ?? (['left', 'center', 'right'].includes(el.style.textAlign) ? el.style.textAlign : 'left')) as 'left' | 'center' | 'right'}
          onChange={(textAlign) => patch({ textAlign }, 'textAlign')}
          options={[
            { value: 'left', label: <AlignLeft size={14} /> },
            { value: 'center', label: <AlignCenter size={14} /> },
            { value: 'right', label: <AlignRight size={14} /> },
          ]}
        />
        <div className="grow" />
        <button className={`icon-btn${s.fontStyle === 'italic' ? ' active' : ''}`} title="기울임" onClick={() => patch({ fontStyle: s.fontStyle === 'italic' ? 'normal' : 'italic' }, 'fontStyle')}>
          <Italic size={14} />
        </button>
        <button className={`icon-btn${s.textDecoration === 'underline' ? ' active' : ''}`} title="밑줄" onClick={() => patch({ textDecoration: s.textDecoration === 'underline' ? 'none' : 'underline' }, 'textDecoration')}>
          <Underline size={14} />
        </button>
        <button className={`icon-btn${s.textDecoration === 'line-through' ? ' active' : ''}`} title="취소선" onClick={() => patch({ textDecoration: s.textDecoration === 'line-through' ? 'none' : 'line-through' }, 'textDecoration')}>
          <Strikethrough size={14} />
        </button>
        <button className={`icon-btn${s.textTransform === 'uppercase' ? ' active' : ''}`} title="영문 대문자" onClick={() => patch({ textTransform: s.textTransform === 'uppercase' ? 'none' : 'uppercase' }, 'textTransform')}>
          <CaseUpper size={14} />
        </button>
      </div>
      <div className="row small">
        <Toggle on={!!s.textStroke || isKeyed(id, 'textStrokeWidth')} onChange={(on) => patch({ textStroke: on ? { width: 2, color: '#000000' } : null }, 'textStroke')} />
        <span className="grow">글자 테두리</span>
      </div>
      {(s.textStroke || isKeyed(id, 'textStrokeWidth')) && (
        <>
          <Prop id={id} p="textStrokeWidth" label="테두리 두께" />
          <Prop id={id} p="textStrokeColor" label="테두리 색" />
        </>
      )}
      <div className="col" style={{ gap: 6, paddingTop: 4 }} data-testid="text-anim">
        <div className="row small">
          <span style={{ width: 70 }}>글자 애니메이션</span>
          <select
            className="select grow"
            style={{ height: 28 }}
            value={o.textAnim?.preset ?? ''}
            onChange={(e) => {
              const preset = e.target.value as TextAnimPreset | ''
              patchElement(id, label, { textAnim: preset ? { start: snapT(useEditor.getState().time), duration: 0.45, stagger: 0.05, by: 'char', ...o.textAnim, preset } : null }, ['textAnim'])
            }}
            data-testid="text-anim-preset"
          >
            <option value="">없음</option>
            {TEXT_ANIMS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        {o.textAnim && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumberField title="첫 글자가 시작하는 시점" label="시작" unit="초" min={0} step={0.1} precision={2} value={o.textAnim.start} onChange={(start) => patchElement(id, label, { textAnim: { ...o.textAnim!, start } }, ['textAnim'])} />
            <NumberField title="글자 하나가 나타나는 길이" label="길이" unit="초" min={0.05} step={0.05} precision={2} value={o.textAnim.duration} onChange={(duration) => patchElement(id, label, { textAnim: { ...o.textAnim!, duration } }, ['textAnim'])} />
            <NumberField title="글자 사이 간격" label="간격" unit="초" min={0} step={0.01} precision={2} value={o.textAnim.stagger} onChange={(stagger) => patchElement(id, label, { textAnim: { ...o.textAnim!, stagger } }, ['textAnim'])} />
            <Segmented full value={o.textAnim.by} onChange={(by) => patchElement(id, label, { textAnim: { ...o.textAnim!, by } }, ['textAnim'])} options={[{ value: 'char', label: '글자' }, { value: 'word', label: '단어' }]} />
          </div>
        )}
        {o.textAnim?.preset === 'custom' && <CustomTextAnim id={id} />}
      </div>
      <div className="col" style={{ gap: 6, paddingTop: 4 }} data-testid="counter">
        <div className="row small">
          <Toggle on={!!c} onChange={(on) => setCounter(on ? counterFrom(current, snapT(useEditor.getState().time)) : null)} />
          <span className="grow">숫자 카운트 (가격·퍼센트가 올라가요)</span>
        </div>
        {c && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumberField label="처음" value={c.from} precision={c.decimals} onChange={(from) => setCounter({ ...c, from })} />
            <NumberField label="끝" value={c.to} precision={c.decimals} onChange={(to) => setCounter({ ...c, to })} />
            <NumberField label="시작" unit="초" min={0} step={0.1} precision={2} value={c.start} onChange={(start) => setCounter({ ...c, start })} />
            <NumberField label="길이" unit="초" min={0.05} step={0.1} precision={2} value={c.duration} onChange={(duration) => setCounter({ ...c, duration })} />
            <NumberField label="소수" unit="자리" min={0} max={4} value={c.decimals} onChange={(decimals) => setCounter({ ...c, decimals })} />
            <div className="row small">
              <Toggle on={c.comma} onChange={(comma) => setCounter({ ...c, comma })} />
              <span>쉼표</span>
            </div>
            <input className="input" style={{ height: 28 }} placeholder="앞 글자" value={c.prefix ?? ''} onChange={(e) => setCounter({ ...c, prefix: e.target.value })} />
            <input className="input" style={{ height: 28 }} placeholder="뒤 글자 (원, %)" value={c.suffix ?? ''} onChange={(e) => setCounter({ ...c, suffix: e.target.value })} data-testid="counter-suffix" />
          </div>
        )}
      </div>
    </Section>
  )
}

/** a CSS colour that shows (not transparent, not fully clear) */
const seenColour = (c: string | undefined) => {
  if (!c || c === 'transparent') return false
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return true
  const a = m[1].split(',')[3]
  return a == null || parseFloat(a) > 0
}

function ShapeSection({ id }: { id: string }) {
  // values at the playhead: drawn again when it moves
  useEditor((s) => s.time)
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const { patchElement } = useOverrides()
  const label = labelOf(id)
  const s = o.style ?? {}
  const patchStyle = (style: ElementStyle, key: string) => patchElement(id, label, { style }, [key])
  const fillOn = s.fill != null || isKeyed(id, 'fill')
  const gradOn = !!s.gradient || isKeyed(id, 'gradA') || isKeyed(id, 'gradB')
  const strokeOn = !!s.stroke || isKeyed(id, 'strokeWidth')
  const any = fillOn || gradOn || strokeOn || s.radius != null
  // a text of Claude's that carries its own coloured box: Claude can make the box a layer of its own
  const el = useEditor((st) => st.elements.find((e) => e.id === id))
  const { project, toast } = useStore()
  const boxed = !!el && el.type === 'text' && !el.designer && !id.includes('~') && seenColour(el.style.background)
  return (
    <Section title="모양" right={any && <button className="btn ghost sm" style={{ height: 22 }} onClick={() => patchElement(id, label, { style: { fill: undefined, stroke: undefined, radius: undefined, gradient: null } }, ['fill'])}>되돌리기</button>}>
      {boxed && (
        <div className="row tiny" style={{ gap: 6, padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)' }} data-testid="split-box">
          <span className="grow muted">글자와 배경 상자가 한 레이어예요. 따로 고치려면 나눠요.</span>
          <button
            className="btn sm"
            style={{ height: 24 }}
            onClick={async () => {
              try {
                await studio.agent.splitLayer(project!.meta.id, id)
                toast('Claude에게 글자와 배경을 나눠 달라고 했어요. 끝나면 두 레이어로 보여요.', 'success')
              } catch (e) {
                toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
              }
            }}
            data-testid="split-box-run"
          >
            배경 따로 떼기
          </button>
        </div>
      )}
      <div className="row small">
        <Toggle on={fillOn && !gradOn} onChange={(on) => patchStyle({ fill: on ? String(anyNow(id, 'fill')) : undefined, gradient: null }, 'fill')} />
        <span className="grow">채우기</span>
        <Toggle on={gradOn} onChange={(on) => patchStyle({ gradient: on ? { a: String(anyNow(id, 'fill')), b: '#ff5c8a', angle: 135 } : null }, 'gradient')} />
        <span>그라디언트</span>
      </div>
      {fillOn && !gradOn && <Prop id={id} p="fill" />}
      {gradOn && (
        <>
          <Prop id={id} p="gradA" label="시작 색" />
          <Prop id={id} p="gradB" label="끝 색" />
          <Prop id={id} p="gradAngle" label="각도" />
        </>
      )}
      <div className="row small">
        <Toggle on={strokeOn} onChange={(on) => patchStyle({ stroke: on ? { width: 4, color: '#ffffff' } : null }, 'stroke')} />
        <span className="grow">테두리</span>
      </div>
      {strokeOn && (
        <>
          <Prop id={id} p="strokeWidth" />
          <Prop id={id} p="strokeColor" />
        </>
      )}
      <Prop id={id} p="radius" />
    </Section>
  )
}

function EffectsSection({ id }: { id: string }) {
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const { patchElement } = useOverrides()
  const label = labelOf(id)
  const fx = o.effects ?? {}
  const shadowOn = !!fx.shadow || isKeyed(id, 'shadowX') || isKeyed(id, 'shadowY') || isKeyed(id, 'shadowBlur') || isKeyed(id, 'shadowColor')
  const glowOn = !!fx.glow || isKeyed(id, 'glowBlur') || isKeyed(id, 'glowColor')
  const any = Object.entries(fx).some(([k, v]) => v != null && !(k === 'blend' && v === 'normal'))
  return (
    <Section title="효과" right={any && <button className="btn ghost sm" style={{ height: 22 }} onClick={() => patchElement(id, label, { effects: { blend: undefined, blur: undefined, brightness: undefined, contrast: undefined, saturate: undefined, hue: undefined, grayscale: undefined, sepia: undefined, invert: undefined, shadow: null, glow: null } }, ['effects'])}>효과 모두 끄기</button>}>
      <div className="row small">
        <span style={{ width: 52 }}>블렌드</span>
        <select className="select grow" style={{ height: 28 }} value={fx.blend ?? 'normal'} onChange={(e) => patchElement(id, label, { effects: { blend: e.target.value } }, ['effects'])} data-testid="fx-blend">
          {BLENDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {(['blur', 'brightness', 'contrast', 'saturate', 'hue', 'grayscale', 'sepia', 'invert'] as const).map((p) => (
        <Prop key={p} id={id} p={p} />
      ))}
      <div className="row small">
        <Toggle on={shadowOn} onChange={(on) => patchElement(id, label, { effects: { shadow: on ? { x: 0, y: 12, blur: 24, color: '#00000088' } : null } }, ['effects'])} />
        <span className="grow">그림자</span>
      </div>
      {shadowOn && (
        <>
          <Prop id={id} p="shadowX" label="그림자 X" />
          <Prop id={id} p="shadowY" label="그림자 Y" />
          <Prop id={id} p="shadowBlur" label="그림자 흐림" />
          <Prop id={id} p="shadowColor" label="그림자 색" />
        </>
      )}
      <div className="row small">
        <Toggle on={glowOn} onChange={(on) => patchElement(id, label, { effects: { glow: on ? { blur: 24, color: '#ffffff' } : null } }, ['effects'])} />
        <span className="grow">빛 번짐 (글로우)</span>
      </div>
      {glowOn && (
        <>
          <Prop id={id} p="glowBlur" label="번짐 크기" />
          <Prop id={id} p="glowColor" label="번짐 색" />
        </>
      )}
    </Section>
  )
}

function MaskSection({ id }: { id: string }) {
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const drawing = useEditor((s) => s.maskDraw === id)
  const m = useOverrides((s) => s.value?.elements[id]?.mask)
  const { patchElement } = useOverrides()
  const label = labelOf(id)
  const set = (mask: LayerMask | null) => patchElement(id, label, { mask }, ['mask'])
  const full = (shape: LayerMask['shape']): LayerMask => ({ shape, x: 0, y: 0, w: Math.round(el.base?.w ?? el.rect.w), h: Math.round(el.base?.h ?? el.rect.h), feather: 0 })
  return (
    <Section title="마스크">
      <Segmented
        full
        value={m?.shape ?? 'none'}
        onChange={(v) => set(v === 'none' ? null : m ? { ...m, shape: v } : full(v))}
        options={[
          { value: 'none', label: '없음' },
          { value: 'rect', label: '사각형' },
          { value: 'ellipse', label: '타원' },
        ]}
      />
      {m && (
        <>
          <KeyRow id={id} label="위치" props={['maskX', 'maskY']}>
            <PropField id={id} p="maskX" label="X" />
            <PropField id={id} p="maskY" label="Y" />
          </KeyRow>
          <KeyRow id={id} label="크기" props={['maskW', 'maskH']}>
            <PropField id={id} p="maskW" label="폭" />
            <PropField id={id} p="maskH" label="높이" />
          </KeyRow>
          <Prop id={id} p="maskFeather" label="페더" />
          {m.shape === 'rect' && <NumberField label="모서리" min={0} value={m.radius ?? 0} onChange={(radius) => set({ ...m, radius })} />}
          <div className="row small">
            <Toggle on={!!m.invert} onChange={(invert) => set({ ...m, invert })} />
            <span className="grow">반전 (안쪽을 가리기)</span>
            <button className={`btn sm${drawing ? ' primary' : ''}`} onClick={() => useEditor.setState({ maskDraw: drawing ? null : id })} data-testid="mask-draw">
              {drawing ? '그리기 끝' : '캔버스에서 그리기'}
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

/** line drawing of the strokes inside the layer (After Effects' Trim Paths) */
function TrimSection({ id }: { id: string }) {
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const { patchElement } = useOverrides()
  const on = !!o.trim || isKeyed(id, 'trimStart') || isKeyed(id, 'trimEnd')
  return (
    <Section title="선 그리기" testid="trim">
      <div className="row small">
        <Toggle on={on} onChange={(v) => patchElement(id, labelOf(id), { trim: v ? { start: 0, end: 100 } : null, ...(v ? {} : { keys: { ...(o.keys ?? {}), trimStart: undefined, trimEnd: undefined } }) }, ['trim'])} />
        <span className="grow tiny muted">SVG로 그린 선·아이콘이 그려지듯 나타나요 (끝을 0→100으로 키프레임)</span>
      </div>
      {on && (
        <>
          <Prop id={id} p="trimStart" />
          <Prop id={id} p="trimEnd" />
        </>
      )}
    </Section>
  )
}

function TimeSection({ id }: { id: string }) {
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const ov = useOverrides((s) => s.value)!
  const time = useEditor((s) => s.time)
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const { patchElement } = useOverrides()
  const label = labelOf(id)
  const layer = ov.layers.find((l) => l.id === id)
  return (
    <Section title="시간">
      <div className="row" style={{ gap: 6 }}>
        <NumberField title="이 시점부터 보여요 (In)" label="In" unit="초" step={0.1} precision={2} min={0} value={o.inPoint ?? 0} onChange={(inPoint) => useOverrides.getState().setInOut([{ id, label }], inPoint, undefined)} />
        <button className="btn ghost sm" style={{ height: 26 }} title="지금 시점을 In으로 (⌥[)" onClick={() => useOverrides.getState().setInOut([{ id, label }], snapT(time), undefined)}>
          지금
        </button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <NumberField title="이 시점까지 보여요 (Out)" label="Out" unit="초" step={0.1} precision={2} min={0} value={o.outPoint ?? useEditor.getState().duration} onChange={(outPoint) => useOverrides.getState().setInOut([{ id, label }], undefined, outPoint)} />
        <button className="btn ghost sm" style={{ height: 26 }} title="지금 시점을 Out으로 (⌥])" onClick={() => useOverrides.getState().setInOut([{ id, label }], undefined, snapT(time))}>
          지금
        </button>
        {(o.inPoint != null || o.outPoint != null) && (
          <button className="btn ghost sm" style={{ height: 26 }} onClick={() => useOverrides.getState().setInOut([{ id, label }], null, null)}>
            처음부터 끝까지
          </button>
        )}
      </div>
      {!layer && el.type !== 'part' && (
        <>
          <SpeedSlider value={o.animSpeed ?? 1} onCommit={(animSpeed) => patchElement(id, label, { animSpeed }, ['animSpeed'])} />
          <NumberField
            title="레이어 전체(Claude 움직임, 직접 넣은 키프레임, 인/아웃)를 앞뒤로 옮겨요 · 타임라인 막대를 끌어도 돼요"
            label="시점"
            unit="초"
            value={o.timing?.shift ?? 0}
            step={0.1}
            precision={2}
            min={-60}
            max={60}
            onChange={(shift) => {
              // the field is Claude's (authored) time; the bar, keys and in/out are output time (sections may run at another speed)
              const start = useEditor.getState().timing.find((t) => t.id === id)?.start ?? 0
              const map = makeTimeMap(useStore.getState().project?.brief.output.duration ?? 1, ov.timeRemap ?? [])
              const a0 = map.toAuthored(start)
              // never before 0: the layer stops there with its keys (as the preview stops it)
              const by = +Math.max(shift - (o.timing?.shift ?? 0), -a0).toFixed(3)
              const dt = +(map.toOutput(a0 + by) - start).toFixed(3)
              if (by) useOverrides.getState().shiftLayers([{ id, label, authored: by, dt }])
            }}
          />
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => useEditor.setState({ panel: 'motion', selectedMotion: null })}>
            Claude가 만든 모션 하나하나 조정하기 →
          </button>
        </>
      )}
    </Section>
  )
}

/** Claude's motion speed: dragged freely, saved (one undo step) when let go */
function SpeedSlider({ value, onCommit }: { value: number; onCommit(v: number): void }) {
  const [draft, setDraft] = useState<number | null>(null)
  const commit = () => {
    if (draft != null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <>
      <div className="row tiny muted">
        <span className="grow">Claude가 만든 움직임 속도</span>
        <span className="mono">{(draft ?? value).toFixed(2)}×</span>
      </div>
      <input type="range" min={0.25} max={3} step={0.05} value={draft ?? value} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid="anim-speed" />
    </>
  )
}

function MediaSection({ id }: { id: string }) {
  const { project, toast } = useStore()
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const { value: ov, patchElement, updateLayer } = useOverrides()
  const o = ov?.elements[id] ?? {}
  const layer = ov?.layers.find((l) => l.id === id)
  const label = labelOf(id)
  const isVideo = el.tag === 'video' || layer?.kind === 'video'
  const current = o.src ?? layer?.src ?? el.src ?? ''
  const setSrc = (src: string | undefined) => {
    if (layer && src) updateLayer(id, { src }, `${label}: 파일 바꾸기`)
    else patchElement(id, label, { src }, ['src'])
  }
  const fromFile = async () => {
    const files = await studio.app.pickFiles(isVideo ? 'assets' : 'images')
    if (!files[0] || !project) return
    try {
      const [a] = await studio.projects.importAssets(project.meta.id, [files[0]])
      if (a) setSrc(a.file)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }
  const assets = (project?.brief.assets ?? []).filter((a) => (isVideo ? /\.(mp4|mov|webm|m4v)$/i.test(a.file) : /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a.file)))
  return (
    <Section title={isVideo ? '동영상' : '이미지'}>
      <div className="tiny muted ellipsis" title={current}>
        지금: {current.split('/').pop() || '(없음)'}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => void fromFile()} data-testid="media-replace">
          파일에서 바꾸기
        </button>
        {assets.length > 0 && (
          <select className="select" style={{ height: 28, width: 'auto' }} value="" onChange={(e) => e.target.value && setSrc(e.target.value)}>
            <option value="">소재에서 고르기…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.file}>
                {a.originalName}
              </option>
            ))}
          </select>
        )}
        {o.src && (
          <button className="btn ghost sm" onClick={() => setSrc(undefined)}>
            원래대로
          </button>
        )}
      </div>
    </Section>
  )
}

/** a styled line's parts (a word in another colour…): each edited on its own so it keeps its style */
function TextRuns({ id, runs }: { id: string; runs: string[] }) {
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const { patchElement } = useOverrides()
  const cur = o.textRuns ?? runs
  return (
    <div className="col" style={{ gap: 4 }} data-testid="text-runs">
      <div className="tiny muted">부분별 문구 (꾸밈이 다른 부분은 그 꾸밈을 지켜요)</div>
      {runs.map((r, i) => (
        <input
          key={i}
          className="input"
          style={{ height: 28 }}
          defaultValue={cur[i] ?? r}
          onBlur={(e) => {
            if (e.target.value === (cur[i] ?? r)) return
            const next = runs.map((x, j) => (j === i ? e.target.value : cur[j] ?? x))
            patchElement(id, labelOf(id), { textRuns: next, text: undefined }, ['text'])
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid={`text-run-${i}`}
        />
      ))}
    </div>
  )
}

/** words in their own colour / weight wherever they appear */
function Highlights({ id }: { id: string }) {
  const list = useOverrides((s) => s.value?.elements[id]?.highlights) ?? []
  const { patchElement } = useOverrides()
  const [word, setWord] = useState('')
  const set = (highlights: NonNullable<typeof list>) => patchElement(id, labelOf(id), { highlights: highlights.length ? highlights : null }, ['text'])
  return (
    <div className="col" style={{ gap: 4 }} data-testid="highlights">
      {list.map((h, i) => (
        <div key={i} className="row small" style={{ gap: 4 }}>
          <span className="ellipsis" style={{ width: 70 }} title={h.text}>
            {h.text}
          </span>
          <ColorField value={h.color ?? '#ff5c00'} onChange={(color) => set(list.map((x, j) => (j === i ? { ...x, color } : x)))} />
          <button className={`icon-btn${h.weight ? ' active' : ''}`} title="굵게" onClick={() => set(list.map((x, j) => (j === i ? { ...x, weight: x.weight ? undefined : 800 } : x)))}>
            B
          </button>
          <button className="icon-btn" title="강조 빼기" onClick={() => set(list.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className="row small" style={{ gap: 4 }}>
        <input className="input grow" style={{ height: 28 }} placeholder="강조할 단어 (예: 50%)" value={word} onChange={(e) => setWord(e.target.value)} data-testid="highlight-word" />
        <button
          className="btn sm"
          disabled={!word.trim()}
          onClick={() => {
            set([...list, { text: word.trim(), color: '#ff5c00', weight: 800 }])
            setWord('')
          }}
          data-testid="highlight-add"
        >
          강조
        </button>
      </div>
    </div>
  )
}

/** the text changes at set times (Source Text keyframes): each holds until the next */
function TimedText({ id }: { id: string }) {
  // values at the playhead: drawn again when it moves
  useEditor((s) => s.time)
  const list = useOverrides((s) => s.value?.elements[id]?.textKeys) ?? []
  const counter = useOverrides((s) => !!s.value?.elements[id]?.counter)
  const { patchElement } = useOverrides()
  const set = (textKeys: NonNullable<typeof list>) => patchElement(id, labelOf(id), { textKeys: textKeys.length ? [...textKeys].sort((a, b) => a.t - b.t) : null }, ['text'])
  if (counter) return null
  return (
    <div className="col" style={{ gap: 4 }} data-testid="timed-text">
      {list.map((k, i) => (
        <div key={i} className="row small" style={{ gap: 4 }}>
          <NumberField label="◆" unit="초" min={0} step={0.1} precision={2} value={k.t} onChange={(t) => set(list.map((x, j) => (j === i ? { ...x, t } : x)))} />
          <input className="input grow" style={{ height: 28 }} defaultValue={k.text} onBlur={(e) => e.target.value !== k.text && set(list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button className="icon-btn" title="빼기" onClick={() => set(list.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        className="btn ghost sm"
        style={{ alignSelf: 'flex-start', height: 24 }}
        title="지금 시점부터 다른 문구로 바뀌어요"
        onClick={() => set([...list, { t: snapT(useEditor.getState().time), text: useEditor.getState().elements.find((e) => e.id === id)?.text ?? '' }])}
        data-testid="timed-text-add"
      >
        + 지금 시점에 문구 바꾸기
      </button>
    </div>
  )
}

/** the designer's own text animator: where each letter starts from */
function CustomTextAnim({ id }: { id: string }) {
  const a = useOverrides((s) => s.value?.elements[id]?.textAnim)!
  const { patchElement } = useOverrides()
  const c = a.custom ?? { y: 40, opacity: 0 }
  const set = (custom: NonNullable<typeof a.custom>) => patchElement(id, labelOf(id), { textAnim: { ...a, custom } }, ['textAnim'])
  return (
    <div className="col" style={{ gap: 6 }} data-testid="text-anim-custom">
      <div className="tiny muted">글자마다 이 상태에서 시작해 제자리로 와요</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberField label="X" unit="px" value={c.x ?? 0} onChange={(x) => set({ ...c, x })} />
        <NumberField label="Y" unit="px" value={c.y ?? 0} onChange={(y) => set({ ...c, y })} />
        <NumberField label="크기" unit="%" value={Math.round((c.scale ?? 1) * 100)} onChange={(p) => set({ ...c, scale: p / 100 })} />
        <NumberField label="회전" unit="°" value={c.rotate ?? 0} onChange={(rotate) => set({ ...c, rotate })} />
        <NumberField label="흐림" unit="px" min={0} value={c.blur ?? 0} onChange={(blur) => set({ ...c, blur })} />
        <NumberField label="불투명" unit="%" min={0} max={100} value={Math.round((c.opacity ?? 0) * 100)} onChange={(p) => set({ ...c, opacity: p / 100 })} />
      </div>
      <Segmented
        full
        value={a.order ?? 'start'}
        onChange={(order) => patchElement(id, labelOf(id), { textAnim: { ...a, order } }, ['textAnim'])}
        options={[
          { value: 'start', label: '앞부터' },
          { value: 'center', label: '가운데부터' },
          { value: 'end', label: '끝부터' },
          { value: 'edges', label: '양끝부터' },
        ]}
      />
    </div>
  )
}

/**
 * Linking and compositing (After Effects' parent pick-whip, track matte, motion blur, time
 * stretch): follow another layer, move into another group, be shaped by an image, blur along
 * the movement, a clip faster / slower / backwards.
 */
function LinkSection({ id }: { id: string }) {
  // values at the playhead: drawn again when it moves
  useEditor((s) => s.time)
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const elements = useEditor((s) => s.elements)
  const o = useOverrides((s) => s.value?.elements[id]) ?? {}
  const { patchElement } = useOverrides()
  const label = labelOf(id)
  const inside = (a: string, b: string | null): boolean => !!b && (a === b || inside(a, elements.find((e) => e.id === b)?.parent ?? null))
  const others = elements.filter((e) => e.id !== id && !['sfx', 'bgm', 'voice', 'camera'].includes(e.type) && !inside(id, e.parent) && !inside(e.id, el.parent))
  const groups = others.filter((e) => e.type === 'group' && e.id !== el.parent)
  const images = others.filter((e) => e.type === 'image' || e.tag === 'img')
  const isVideo = el.tag === 'video' || el.type === 'video'
  const fx = o.videoFx ?? {}
  return (
    <Section title="연결과 합성" testid="link">
      <div className="row small" style={{ gap: 6 }}>
        <span style={{ width: 52 }}>부모</span>
        <select
          className="select grow"
          style={{ height: 28 }}
          value={o.parent?.id ?? ''}
          title="고른 레이어가 움직이고 돌고 커지는 대로 따라가요 (지금 시점부터의 변화)"
          onChange={(e) => patchElement(id, label, { parent: e.target.value ? { id: e.target.value, at: snapT(useEditor.getState().time) } : null }, ['link'])}
          data-testid="link-parent"
        >
          <option value="">없음</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.type === 'part' ? `${labelOf(e.parent ?? '')} › ` : ''}
              {labelOf(e.id)}
            </option>
          ))}
        </select>
      </div>
      {groups.length > 0 && (
        <div className="row small" style={{ gap: 6 }}>
          <span style={{ width: 52 }}>그룹</span>
          <select className="select grow" style={{ height: 28 }} value={o.moveTo ?? ''} title="다른 그룹 안으로 옮겨요 (그 그룹과 함께 움직이고 그 안에서 겹쳐요)" onChange={(e) => patchElement(id, label, { moveTo: e.target.value || null }, ['link'])} data-testid="link-group">
            <option value="">원래 그룹</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {labelOf(g.id)}
              </option>
            ))}
          </select>
        </div>
      )}
      {images.length > 0 && (
        <>
          <div className="row small" style={{ gap: 6 }}>
            <span style={{ width: 52 }}>트랙 매트</span>
            <select
              className="select grow"
              style={{ height: 28 }}
              value={o.matte?.layer ?? ''}
              title="고른 이미지의 모양대로만 보여요 (그 이미지는 숨겨져요)"
              onChange={(e) => patchElement(id, label, { matte: e.target.value ? { layer: e.target.value, mode: o.matte?.mode ?? 'alpha' } : null }, ['matte'])}
              data-testid="link-matte"
            >
              <option value="">없음</option>
              {images.map((g) => (
                <option key={g.id} value={g.id}>
                  {labelOf(g.id)}
                </option>
              ))}
            </select>
          </div>
          {o.matte && (
            <Segmented
              full
              value={o.matte.mode}
              onChange={(mode) => patchElement(id, label, { matte: { ...o.matte!, mode } }, ['matte'])}
              options={[
                { value: 'alpha', label: '알파' },
                { value: 'alphaInv', label: '알파 반전' },
                { value: 'luma', label: '밝기' },
                { value: 'lumaInv', label: '밝기 반전' },
              ]}
            />
          )}
        </>
      )}
      <div className="row small" style={{ gap: 6 }}>
        <Toggle on={!!o.motionBlur} onChange={(on) => patchElement(id, label, { motionBlur: on ? 0.5 : null }, ['blur'])} />
        <span className="grow">모션 블러 (키프레임 움직임)</span>
        {!!o.motionBlur && <NumberField title="셔터: 한 프레임 중 열려 있는 비율" label="셔터" unit="%" min={5} max={100} value={Math.round(o.motionBlur * 100)} onChange={(p) => patchElement(id, label, { motionBlur: p / 100 }, ['blur'])} />}
      </div>
      {isVideo && (
        <div className="row small" style={{ gap: 6 }}>
          <NumberField title="영상 재생 속도" label="속도" unit="×" min={0.25} max={4} step={0.25} precision={2} value={fx.speed ?? 1} onChange={(speed) => patchElement(id, label, { videoFx: { ...fx, speed } }, ['video'])} />
          <Toggle on={!!fx.reverse} onChange={(reverse) => patchElement(id, label, { videoFx: { ...fx, reverse } }, ['video'])} />
          <span>거꾸로</span>
        </div>
      )}
    </Section>
  )
}
