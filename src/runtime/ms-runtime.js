/* Motion Studio runtime
 * Applies designer overrides (window.__MS_OVERRIDES__) on top of an
 * agent-authored HyperFrames composition without touching its source, and
 * answers the editor's questions about editable elements over postMessage.
 * Claude makes the video; the designer edits it like in After Effects.
 *
 *  - style:     typography, fill / stroke / radius via an !important stylesheet
 *  - transform: position, scale X/Y, rotation (2D and 3D), anchor point and opacity
 *               on an invisible wrapper the runtime puts around each absolutely-
 *               positioned editable element, through non-inheriting CSS variables
 *               (--ms-x …). GSAP never targets the wrapper, so designer moves compose
 *               with authored motion instead of being folded into GSAP's transform
 *               cache (GSAP re-parses computed translate/rotate/scale on invalidate).
 *  - keyframes: the designer's keyframes become GSAP tweens of those variables on
 *               the output timeline; in/out points switch --ms-io
 *  - effects:   filter / blend / mask on the wrapper (an adjustment layer filters
 *               what is behind it with backdrop-filter)
 *  - text, src: replaced while the parser inserts the node, i.e. before the
 *               composition's own scripts (SplitText etc.) run
 *  - duplicates: a copy of an element is inserted next to it when the main timeline
 *               registers, and every tween of the original is repeated for the copy
 *  - order:     the designer's stacking order permutes siblings in their own slots
 *  - animSpeed: timeScale on every tween that targets the element
 *  - motions:   each tween the composition creates is recorded (for the
 *               editor's timeline) and designer edits to its length, easing,
 *               values or on/off are applied to its vars before GSAP sees them;
 *               start shifts are applied once the timeline is registered
 *  - timeRemap: section speed changes via a wrapper timeline scrubbing the
 *               authored one; clip data-start/duration are remapped to match
 *  - nested editables that are not absolutely positioned (inside a phone
 *    mockup, a card…) move with relative left/top instead of a wrapper
 *
 * This file is managed by Motion Studio. Compositions must not edit it.
 */
(function () {
  'use strict'
  var O = window.__MS_OVERRIDES__ || {}
  var EL = O.elements || {}
  var REMAP = (O.timeRemap || []).filter(function (s) { return s.to > s.from && s.speed > 0 })
    .sort(function (a, b) { return a.from - b.from })
  var KEEP_TOTAL = O.keepTotalDuration !== false
  var DUPS = (O.duplicates || []).filter(function (d) { return d && d.id && d.of && d.id !== d.of })
  var ORDER = O.order || {}
  var FREEZE = O.freeze || {}

  // ---- 0. motions ---------------------------------------------------------------
  // Tweens are keyed "<owner data-ms-id>#<n>" (n-th tween created for that element)
  // with a signature (kind + animated properties) so an edit is dropped, not
  // misapplied, when Claude rewrites the code.
  var MO = O.motions || {}
  var SPECIAL = {}
  ;('ease duration delay stagger repeat repeatDelay yoyo yoyoEase repeatRefresh paused overwrite immediateRender lazy ' +
    'inherit id data callbackScope startAt runBackwards keyframes reversed clearProps modifiers snap scrollTrigger ' +
    'onStart onStartParams onUpdate onUpdateParams onComplete onCompleteParams onRepeat onRepeatParams ' +
    'onReverseComplete onReverseCompleteParams onInterrupt onInterruptParams parent easeEach').split(' ').forEach(function (k) { SPECIAL[k] = 1 })
  var MOTIONS = []
  var MCOUNT = {}
  var STALE = []
  /** the runtime's own tweens (designer keyframes) are not the composition's motions */
  var CAPTURE_OFF = false
  function ownersOf(targets) {
    var arr
    try { arr = window.gsap.utils.toArray(targets) } catch (e) { return [] }
    var seen = {}, out = []
    arr.forEach(function (t) { var id = ownerId(t); if (id && !seen[id]) { seen[id] = 1; out.push(id) } })
    return out
  }
  /** the layer a tween moves itself (every target is that one element), else null */
  function selfIdOf(targets) {
    var arr
    try { arr = window.gsap.utils.toArray(targets) } catch (e) { return null }
    var id = null
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i], tid = t && t.nodeType === 1 && t.getAttribute('data-ms-id')
      if (!tid || (id && tid !== id)) return null
      id = tid
    }
    return id
  }
  function propsOf(vars) {
    return Object.keys(vars || {}).filter(function (k) { return !SPECIAL[k] })
  }
  /** properties named in a keyframes value (an array, "25%" steps, or one array per property) */
  function kfProps(kf) {
    var out = []
    function add(k) { if (!SPECIAL[k] && !/%$/.test(k) && out.indexOf(k) < 0) out.push(k) }
    if (Array.isArray(kf)) kf.forEach(function (f) { Object.keys(f || {}).forEach(add) })
    else if (kf && typeof kf === 'object') Object.keys(kf).forEach(function (k) { if (/%$/.test(k)) Object.keys(kf[k] || {}).forEach(add); else add(k) })
    return out
  }
  function copyKeyframes(kf) {
    if (Array.isArray(kf)) return kf.map(function (f) { return Object.assign({}, f) })
    var c = Object.assign({}, kf)
    Object.keys(c).forEach(function (k) { if (/%$/.test(k) && c[k] && typeof c[k] === 'object') c[k] = Object.assign({}, c[k]) })
    return c
  }
  function dropFromKeyframes(kf, p) {
    if (Array.isArray(kf)) kf.forEach(function (f) { if (f) delete f[p] })
    else if (kf && typeof kf === 'object') { delete kf[p]; Object.keys(kf).forEach(function (k) { if (/%$/.test(k) && kf[k]) delete kf[k][p] }) }
  }
  function numeric(v) {
    return typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d*\.?\d+(px|%|deg|rad|turn|rem|em|vw|vh)?\s*$/.test(v))
  }
  function shown(v) {
    if (typeof v === 'function') return 'ƒ'
    if (v && typeof v === 'object') return '…'
    return v
  }
  /** motion edits whose code changed (or moved): matched again once every tween exists */
  var LATE = []
  /** records a tween about to be created and returns vars with designer edits applied */
  function captureMotion(type, targets, a, b) {
    if (CAPTURE_OFF) return null
    var owners = ownersOf(targets)
    if (!owners.length) return null
    var toVars = type === 'fromTo' ? b : a
    var fromVars = type === 'fromTo' ? a : null
    if (!toVars || typeof toVars !== 'object') return null
    var kf = toVars.keyframes
    var props = kf ? kfProps(kf) : propsOf(toVars)
    if (fromVars) propsOf(fromVars).forEach(function (k) { if (props.indexOf(k) < 0) props.push(k) })
    if (!props.length) return null
    var primary = owners[0]
    var kind = kf ? 'keyframes' : type
    // set and keyframes tweens are numbered apart, so the keys of to / from / fromTo stay what they
    // were before they were recorded (edits saved by earlier versions keep finding their tween)
    var series = kind === 'set' ? 'set' : kind === 'keyframes' ? 'kf' : ''
    var n = (MCOUNT[series + primary] = (MCOUNT[series + primary] || 0) + 1)
    var key = primary + '#' + series + n
    var sig = kind + ':' + props.slice().sort().join(',')
    var self = selfIdOf(targets)
    var st = toVars.stagger
    var rec = {
      key: key, owners: owners, type: kind, sig: sig, props: [], self: self,
      ease: typeof toVars.ease === 'string' ? toVars.ease : toVars.ease ? 'custom' : '',
      duration: type === 'set' ? 0 : typeof toVars.duration === 'number' ? toVars.duration : 0.5,
      stagger: !!st, staggerEach: typeof st === 'number' ? st : st && typeof st === 'object' ? (typeof st.each === 'number' ? st.each : null) : null,
      staggerFrom: st && typeof st === 'object' && typeof st.from === 'string' ? st.from : 'start',
      repeat: toVars.repeat | 0, yoyo: !!toVars.yoyo,
      shift: 0, edited: false, disabled: false, tween: null, editKey: null,
    }
    props.forEach(function (k) {
      var p = { name: k }
      if (kf) p.to = '…'
      else if (type === 'to' || type === 'set') p.to = shown(toVars[k])
      else if (type === 'from') p.from = shown(toVars[k])
      else {
        if (fromVars && k in fromVars) p.from = shown(fromVars[k])
        if (k in toVars) p.to = shown(toVars[k])
      }
      p.editable = !kf && (p.from === undefined || numeric(p.from)) && (p.to === undefined || numeric(p.to))
      p.color = !kf && typeof toVars[k] === 'string' && /^(#|rgb|hsl)/.test(toVars[k])
      rec.props.push(p)
    })
    // always pass fresh copies: the copy identifies the created tween (tween.vars === copy)
    toVars = Object.assign({}, toVars)
    if (kf) toVars.keyframes = copyKeyframes(kf)
    if (fromVars) fromVars = Object.assign({}, fromVars)
    // properties the designer took over play from the designer's keyframes instead
    var own = self && EL[self] && EL[self].own
    if (own) {
      rec.props.forEach(function (p) {
        if (!own[p.name] || !own[p.name].length) return
        p.owned = true
        if (kf) dropFromKeyframes(toVars.keyframes, p.name)
        else { delete toVars[p.name]; if (fromVars) delete fromVars[p.name] }
      })
    }
    var o = MO[key]
    if (o && o.sig === sig) applyMotionEdit(rec, o, type, toVars, fromVars, props, key)
    MOTIONS.push(rec)
    return { rec: rec, a: type === 'fromTo' ? fromVars : toVars, b: toVars }
  }
  /** a designer's motion edit on the vars before GSAP sees them */
  function applyMotionEdit(rec, o, type, toVars, fromVars, props, editKey) {
    rec.edited = true
    rec.editKey = editKey
    rec.shift = +o.shift || 0
    if (o.disabled) {
      rec.disabled = true
      props.forEach(function (k) { delete toVars[k]; if (fromVars) delete fromVars[k] })
      if (toVars.keyframes) delete toVars.keyframes
      return
    }
    if (typeof o.duration === 'number' && o.duration >= 0 && type !== 'set') toVars.duration = o.duration
    if (o.ease) toVars.ease = o.ease
    if (o.stagger && toVars.stagger) toVars.stagger = staggerOf(o.stagger, toVars.stagger)
    Object.keys(o.values || {}).forEach(function (vk) {
      var dot = vk.indexOf('.'), side = vk.slice(0, dot), prop = vk.slice(dot + 1), v = o.values[vk]
      if (props.indexOf(prop) < 0) return
      if (type === 'fromTo') { if (side === 'from') fromVars[prop] = v; else toVars[prop] = v }
      else if (((type === 'to' || type === 'set') && side === 'to') || (type === 'from' && side === 'from')) toVars[prop] = v
    })
  }
  /** the designer's spacing of a staggered motion: each, where it starts, extra delays per item */
  function staggerOf(s, orig) {
    var each = typeof s.each === 'number' ? s.each : typeof orig === 'number' ? orig : (orig && orig.each) || 0.05
    var from = s.from || (orig && typeof orig === 'object' && orig.from) || 'start'
    var extra = s.offsets || {}
    if (!Object.keys(extra).length) return { each: each, from: from }
    return function (i, target, list) {
      var n = list.length, c = (n - 1) / 2
      var pos = from === 'end' ? n - 1 - i : from === 'center' ? Math.abs(i - c) : from === 'edges' ? c - Math.abs(i - c) : i
      return pos * each + (+extra[i] || 0)
    }
  }
  function hookGsap() {
    var g = window.gsap
    if (!g || g.__msHooked) return
    g.__msHooked = true
    function wrap(owner, name, isTimeline) {
      var orig = owner[name]
      if (typeof orig !== 'function') return
      owner[name] = function (targets) {
        // GSAP builds a stagger from one tween per target inside a "nested" timeline of its own:
        // those are recorded (each target's own times, numbered as before) but are no motion blocks
        var nested = isTimeline && this && this.data === 'nested'
        var args = Array.prototype.slice.call(arguments)
        var r = null
        // legacy signature: (targets, duration, vars[, toVars])
        var legacy = name !== 'set' && typeof args[1] === 'number'
        var i = legacy ? 2 : 1
        try {
          r = name === 'fromTo' ? captureMotion('fromTo', targets, args[i], args[i + 1]) : captureMotion(name, targets, args[i])
        } catch (e) { r = null }
        if (r) {
          if (nested) r.rec.nested = true
          if (name === 'fromTo') { args[i] = r.a; args[i + 1] = r.b } else args[i] = r.b
          if (legacy && typeof r.b.duration === 'number') args[1] = r.b.duration
        }
        var res = orig.apply(this, args)
        if (r) {
          if (!isTimeline) r.rec.tween = res
          else {
            var kids = this.getChildren(false, true, false)
            for (var k = kids.length - 1; k >= 0; k--) if (kids[k].vars === r.b) { r.rec.tween = kids[k]; break }
          }
        }
        return res
      }
    }
    ;['to', 'from', 'fromTo', 'set'].forEach(function (m) {
      wrap(g, m, false)
      if (g.core && g.core.Timeline) wrap(g.core.Timeline.prototype, m, true)
    })
  }
  hookGsap()
  function inRoot(tw, root) {
    for (var p = tw.parent; p; p = p.parent) if (p === root) return true
    return false
  }
  /** an edit applied after the tween exists (its code moved): GSAP reads the vars again */
  function lateApply(m, o, editKey) {
    var tw = m.tween
    if (!tw) return
    m.edited = true
    m.editKey = editKey
    m.shift = +o.shift || 0
    if (o.disabled) { m.disabled = true; tw.kill(); return }
    if (typeof o.duration === 'number' && o.duration >= 0 && m.type !== 'set') { tw.duration(o.duration); m.duration = o.duration }
    if (o.ease) tw.vars.ease = o.ease
    var props = m.props.map(function (p) { return p.name })
    Object.keys(o.values || {}).forEach(function (vk) {
      var dot = vk.indexOf('.'), side = vk.slice(0, dot), prop = vk.slice(dot + 1), v = o.values[vk]
      if (props.indexOf(prop) < 0) return
      if (m.type === 'fromTo' && side === 'from') { if (tw.vars.startAt) tw.vars.startAt[prop] = v }
      else if ((side === 'to' && m.type !== 'from') || (side === 'from' && m.type === 'from')) tw.vars[prop] = v
    })
    tw.invalidate()
  }
  function finishMotions(tl, isMain) {
    MOTIONS.forEach(function (m) {
      var tw = m.tween
      if (!tw || !inRoot(tw, tl)) return
      m.start = globalStart(tw, tl)
      // where Claude's code puts it (before the motion's own shift and the layer's)
      m.authored = m.start
    })
    if (isMain) matchLateEdits()
    MOTIONS.forEach(function (m) {
      var tw = m.tween
      if (!tw || !inRoot(tw, tl)) return
      if (m.shift) {
        var k = 1
        for (var p = tw.parent; p && p !== tl; p = p.parent) k *= p.timeScale() || 1
        tw.startTime(Math.max(0, tw.startTime() + m.shift * k))
      }
      m.start = globalStart(tw, tl)
      m.end = m.start + tw.totalDuration() / (tw.timeScale() || 1)
    })
  }
  function matchLateEdits() {
    // edits that no longer sit where they were made: the same kind of motion of the same layer,
    // nearest to where it started when it was edited
    var used = {}
    MOTIONS.forEach(function (m) { if (m.editKey) used[m.editKey] = 1 })
    Object.keys(MO).forEach(function (k) {
      if (used[k]) return
      var o = MO[k], owner = k.slice(0, k.lastIndexOf('#'))
      // CSS animations are matched once the page has them (cssAnimations)
      if (o && String(o.sig).indexOf('css:') === 0) return
      var cands = MOTIONS.filter(function (m) { return m.owners[0] === owner && m.sig === o.sig && !m.edited && m.tween && m.start != null })
      if (o.at != null) cands.sort(function (a, b) { return Math.abs(a.start - o.at) - Math.abs(b.start - o.at) })
      if (cands.length && (o.at != null || cands.length === 1)) lateApply(cands[0], o, k)
      else STALE.push(k)
    })
  }

  // ---- 1. style overrides -----------------------------------------------------------
  // Every property of props.ts is a registered CSS variable: a rule uses the variable and
  // sets its fixed value (or the first keyframe's), keyframe tweens set it inline. Moves and
  // effects sit on the invisible wrapper, type and the box on the element (what is inside it
  // inherits), the camera on <body>.
  var CAMERA = '__camera'
  var TYPO = { fontFamily: 'font-family', fontWeight: 'font-weight', fontStyle: 'font-style',
    textAlign: 'text-align', textDecoration: 'text-decoration', textTransform: 'text-transform' }
  function esc(id) { return String(id).replace(/["\\]/g, '') }
  function cssValue(k, v) {
    if (k === 'fontFamily') return '"' + String(v).replace(/["\;{}]/g, '') + '"'
    return String(v).replace(/[;{}]/g, '')
  }
  function col(c) { return String(c || 'transparent').replace(/[;{}"\\<>]/g, '') }
  function num(v, d) { v = +v; return isFinite(v) ? v : d }

  // [property, css variable, unit ('color' = a colour), target, initial, inherits]
  // (the same list as src/shared/props.ts; mask properties are drawn by the frame hook)
  var PROPDEFS = [
    ['x', '--ms-x', 'px', 'wrap', 0], ['y', '--ms-y', 'px', 'wrap', 0], ['scaleX', '--ms-sx', '', 'wrap', 1], ['scaleY', '--ms-sy', '', 'wrap', 1],
    ['rotate', '--ms-r', 'deg', 'wrap', 0], ['rotateX', '--ms-rx', 'deg', 'wrap', 0], ['rotateY', '--ms-ry', 'deg', 'wrap', 0],
    ['opacity', '--ms-o', '', 'wrap', 1], ['anchorX', '--ms-ax', 'px', 'wrap', 0], ['anchorY', '--ms-ay', 'px', 'wrap', 0],
    ['blur', '--ms-blur', 'px', 'wrap', 0, 1], ['brightness', '--ms-br', '', 'wrap', 100, 1], ['contrast', '--ms-ct', '', 'wrap', 100, 1],
    ['saturate', '--ms-sa', '', 'wrap', 100, 1], ['hue', '--ms-hu', 'deg', 'wrap', 0, 1], ['grayscale', '--ms-gs', '', 'wrap', 0, 1],
    ['sepia', '--ms-sp', '', 'wrap', 0, 1], ['invert', '--ms-iv', '', 'wrap', 0, 1],
    ['shadowX', '--ms-shx', 'px', 'wrap', 0, 1], ['shadowY', '--ms-shy', 'px', 'wrap', 12, 1], ['shadowBlur', '--ms-shb', 'px', 'wrap', 24, 1],
    ['shadowColor', '--ms-shc', 'color', 'wrap', '#00000088', 1], ['glowBlur', '--ms-glb', 'px', 'wrap', 24, 1], ['glowColor', '--ms-glc', 'color', 'wrap', '#ffffff', 1],
    ['color', '--ms-tc', 'color', 'el', '#ffffff'], ['fontSize', '--ms-fs', 'px', 'el', 72], ['letterSpacing', '--ms-ls', 'px', 'el', 0],
    ['lineHeight', '--ms-lh', '', 'el', 1.2], ['textStrokeWidth', '--ms-tsw', 'px', 'el', 2], ['textStrokeColor', '--ms-tsc', 'color', 'el', '#000000'],
    ['fill', '--ms-fill', 'color', 'el', '#7c5cff'], ['strokeWidth', '--ms-sw', 'px', 'el', 4], ['strokeColor', '--ms-sc', 'color', 'el', '#ffffff'],
    ['radius', '--ms-rad', 'px', 'el', 0], ['gradA', '--ms-ga', 'color', 'el', '#7c5cff'], ['gradB', '--ms-gb', 'color', 'el', '#ff5c8a'],
    ['gradAngle', '--ms-gang', 'deg', 'el', 135], ['trimStart', '--ms-ts', '', 'el', 0, 1], ['trimEnd', '--ms-te', '', 'el', 100, 1],
  ]
  var KEYVAR = {}, DEF = {}
  PROPDEFS.forEach(function (d) { KEYVAR[d[0]] = { v: d[1], unit: d[2] === 'color' ? '' : d[2], color: d[2] === 'color', target: d[3] }; DEF[d[0]] = d[4] })
  var MASKPROPS = { maskX: 'x', maskY: 'y', maskW: 'w', maskH: 'h', maskFeather: 'feather' }
  function syntaxOf(unit) { return unit === 'px' ? '<length>' : unit === 'deg' ? '<angle>' : unit === 'color' ? '<color>' : '<number>' }
  function initialOf(unit, v) { return unit === 'color' ? 'transparent' : unit === 'px' || unit === 'deg' ? num(v, 0) + unit : String(num(v, 0)) }
  // registered so they never inherit into nested editables (effects and line drawing do: an
  // adjustment layer's backdrop and the strokes inside a layer read them)
  var VARS = PROPDEFS.map(function (d) { return [d[1], syntaxOf(d[2]), initialOf(d[2], d[4]), !!d[5]] }).concat([
    ['--ms-io', '<number>', '1'], ['--ms-cx', '<length>', '0px'], ['--ms-cy', '<length>', '0px'], ['--ms-cb', '*', 'normal'],
    ['--ms-wx', '<length>', '0px'], ['--ms-wy', '<length>', '0px'], ['--ms-wr', '<angle>', '0deg'], ['--ms-ws', '<number>', '0'], ['--ms-wo', '<number>', '0'],
  ])
  var BASE = VARS.map(function (v) { return '@property ' + v[0] + '{syntax:"' + v[1] + '";inherits:' + (v[3] ? 'true' : 'false') + ';initial-value:' + v[2] + '}' }).join('\n') +
    // the transform itself is only set on layers the designer moved (a transform makes a
    // stacking context, which would change how an untouched layer overlaps its neighbours)
    '\n[data-ms-wrap-for]{transform-origin:calc(var(--ms-cx) + var(--ms-ax)) calc(var(--ms-cy) + var(--ms-ay));' +
    // a blend mode the composition gave the layer itself moves onto its wrapper (--ms-cb), so the
    // wrapper's stacking context does not cut it off from what is behind; the designer's own wins
    'opacity:calc(var(--ms-o) * var(--ms-io));mix-blend-mode:var(--ms-cb)}' +
    // a character part turns about its pivot in the drawing's own units
    '\ng[data-ms-wrap-for]{transform-box:view-box}' +
    '\n[data-ms-solo-off]{opacity:0 !important}' +
    // in / out points of a layer without a wrapper (one the composition lays out)
    '\n[data-ms-io="0"]{visibility:hidden !important}'

  /** geometry of each wrapped element (its box in the wrapper, the wrapper's size), for masks */
  var GEO = {}
  function keyed(o, p) { var k = o.keys && o.keys[p]; return !!(k && k.length) }
  function firstKey(o, p) {
    var ks = (o.keys[p] || []).slice().sort(function (a, b) { return a.t - b.t })
    return ks.length ? ks[0].v : undefined
  }
  /** the fixed value the designer set (undefined = never set); same mapping as props.ts setValue */
  function setOf(o, p) {
    var t = o.transform || {}, fx = o.effects || {}, s = o.style || {}, m = o.mask || null
    switch (p) {
      case 'scaleX': return t.scaleX != null ? t.scaleX : t.scale
      case 'scaleY': return t.scaleY != null ? t.scaleY : t.scale
      case 'shadowX': return fx.shadow ? fx.shadow.x : undefined
      case 'shadowY': return fx.shadow ? fx.shadow.y : undefined
      case 'shadowBlur': return fx.shadow ? fx.shadow.blur : undefined
      case 'shadowColor': return fx.shadow ? fx.shadow.color : undefined
      case 'glowBlur': return fx.glow ? fx.glow.blur : undefined
      case 'glowColor': return fx.glow ? fx.glow.color : undefined
      case 'textStrokeWidth': return s.textStroke ? s.textStroke.width : undefined
      case 'textStrokeColor': return s.textStroke ? s.textStroke.color : undefined
      case 'strokeWidth': return s.stroke ? s.stroke.width : undefined
      case 'strokeColor': return s.stroke ? s.stroke.color : undefined
      case 'gradA': return s.gradient ? s.gradient.a : undefined
      case 'gradB': return s.gradient ? s.gradient.b : undefined
      case 'gradAngle': return s.gradient ? s.gradient.angle : undefined
      case 'trimStart': return o.trim ? o.trim.start : undefined
      case 'trimEnd': return o.trim ? o.trim.end : undefined
    }
    if (MASKPROPS[p]) return m ? m[MASKPROPS[p]] : undefined
    var g = KEYVAR[p] && KEYVAR[p].target
    if (g === 'wrap') return /^(blur|brightness|contrast|saturate|hue|grayscale|sepia|invert)$/.test(p) ? fx[p] : t[p]
    return s[p]
  }
  function cssOf(p, v) { var k = KEYVAR[p]; return k.color ? col(v) : num(v, num(DEF[p], 0)) + k.unit }
  /** "--var: value" for a property: its first keyframe, its fixed value, or its resting value */
  function vdecl(o, p) {
    var v = keyed(o, p) ? firstKey(o, p) : setOf(o, p)
    return KEYVAR[p].v + ':' + cssOf(p, v == null ? DEF[p] : v)
  }
  function has(o, p) { return keyed(o, p) || setOf(o, p) != null }
  function wiggling(o, p) { var w = o.wiggle && o.wiggle[p]; return !!(w && num(w.amount, 0) && num(w.freq, 0) > 0) }

  /** the transform of a wrapper (or of <body> for the camera): variables, transform, opacity */
  function transformDecls(o) {
    var v = []
    ;['x', 'y', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY', 'opacity', 'anchorX', 'anchorY'].forEach(function (p) {
      if (keyed(o, p)) return v.push(vdecl(o, p))
      var sv = setOf(o, p)
      if (sv == null) return
      if (p === 'scaleX' || p === 'scaleY') { if (num(sv, 1) !== 1) v.push(KEYVAR[p].v + ':' + num(sv, 1)) }
      else if (p === 'opacity') { if (num(sv, 1) !== 1) v.push('--ms-o:' + Math.max(0, Math.min(1, num(sv, 1)))) }
      else if (num(sv, 0)) v.push(KEYVAR[p].v + ':' + num(sv, 0) + KEYVAR[p].unit)
    })
    var wx = wiggling(o, 'x'), wy = wiggling(o, 'y'), wr = wiggling(o, 'rotate'), ws = wiggling(o, 'scale')
    var linked = !!(o.parent && o.parent.id), regrouped = !!o.moveTo
    var moved = ['x', 'y', 'scaleX', 'scaleY', 'rotate'].some(function (p) { return keyed(o, p) || (setOf(o, p) != null && num(setOf(o, p), p.indexOf('scale') === 0 ? 1 : 0) !== (p.indexOf('scale') === 0 ? 1 : 0)) }) ||
      wx || wy || wr || ws || linked || regrouped
    var rx = keyed(o, 'rotateX') || num(setOf(o, 'rotateX'), 0), ry = keyed(o, 'rotateY') || num(setOf(o, 'rotateY'), 0)
    var gx = regrouped ? ' + var(--ms-gx, 0px)' : '', gy = regrouped ? ' + var(--ms-gy, 0px)' : ''
    var tr = 'translate(' + (wx || gx ? 'calc(var(--ms-x)' + (wx ? ' + var(--ms-wx)' : '') + gx + ')' : 'var(--ms-x)') + ',' + (wy || gy ? 'calc(var(--ms-y)' + (wy ? ' + var(--ms-wy)' : '') + gy + ')' : 'var(--ms-y)') + ') rotate(' + (wr ? 'calc(var(--ms-r) + var(--ms-wr))' : 'var(--ms-r)') + ')'
    // following a parent layer: its motion since the link, as a matrix the frame hook updates
    if (linked) tr = 'var(--ms-pm,) ' + tr
    var sc = ws ? 'scale(calc(var(--ms-sx) * (1 + var(--ms-ws))),calc(var(--ms-sy) * (1 + var(--ms-ws))))' : 'scale(var(--ms-sx),var(--ms-sy))'
    if (rx || ry) v.push('transform:perspective(2000px) ' + tr + ' rotateX(var(--ms-rx)) rotateY(var(--ms-ry)) ' + sc)
    else if (moved) v.push('transform:' + tr + ' ' + sc)
    if (wiggling(o, 'opacity')) v.push('opacity:calc(var(--ms-o) * var(--ms-io) * (1 - var(--ms-wo)))')
    return v
  }
  /** effects as a filter (variables declared on the wrapper, read by an adjustment layer's backdrop too) */
  function filterDecls(o) {
    var fx = o.effects || {}, f = [], v = []
    function eff(p, fn) {
      if (!keyed(o, p)) {
        var sv = setOf(o, p)
        if (sv == null || num(sv, DEF[p]) === DEF[p]) return
      }
      v.push(vdecl(o, p))
      f.push(fn)
    }
    eff('blur', 'blur(var(--ms-blur))')
    eff('brightness', 'brightness(calc(var(--ms-br) / 100))')
    eff('contrast', 'contrast(calc(var(--ms-ct) / 100))')
    eff('saturate', 'saturate(calc(var(--ms-sa) / 100))')
    eff('hue', 'hue-rotate(var(--ms-hu))')
    eff('grayscale', 'grayscale(calc(var(--ms-gs) / 100))')
    eff('sepia', 'sepia(calc(var(--ms-sp) / 100))')
    eff('invert', 'invert(calc(var(--ms-iv) / 100))')
    if (fx.shadow || ['shadowX', 'shadowY', 'shadowBlur', 'shadowColor'].some(function (p) { return keyed(o, p) })) {
      ;['shadowX', 'shadowY', 'shadowBlur', 'shadowColor'].forEach(function (p) { v.push(vdecl(o, p)) })
      f.push('drop-shadow(var(--ms-shx) var(--ms-shy) var(--ms-shb) var(--ms-shc))')
    }
    if ((fx.glow && num(fx.glow.blur, 0) > 0) || keyed(o, 'glowBlur') || keyed(o, 'glowColor')) {
      v.push(vdecl(o, 'glowBlur'), vdecl(o, 'glowColor'))
      f.push('drop-shadow(0 0 var(--ms-glb) var(--ms-glc)) drop-shadow(0 0 calc(var(--ms-glb) / 3) var(--ms-glc))')
    }
    return { v: v, filter: f.join(' ') }
  }
  /**
   * Where a layer's mask sits. On the element itself by default, so it turns and moves with
   * the layer's own motion (Claude's included); on the wrapper when the composition masks the
   * element already (a reveal Claude wrote), which must keep working.
   */
  var MASK_WRAP = {}
  /** a mask as an SVG luminance mask (white shows, black hides) covering the wrapper's area */
  function maskCss(m, g, onElement) {
    var x = g.l + num(m.x, 0), y = g.t + num(m.y, 0), w = Math.max(0, num(m.w, 0)), h = Math.max(0, num(m.h, 0))
    var f = Math.max(0, num(m.feather, 0))
    var shape = m.shape === 'ellipse'
      ? '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + h / 2) + '" rx="' + w / 2 + '" ry="' + h / 2 + '"'
      : '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + Math.max(0, num(m.radius, 0)) + '"'
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + g.pw + '" height="' + g.ph + '">' +
      (f ? '<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + f / 2 + '"/></filter>' : '') +
      '<rect width="100%" height="100%" fill="' + (m.invert ? 'white' : 'black') + '"/>' +
      shape + ' fill="' + (m.invert ? 'black' : 'white') + '"' + (f ? ' filter="url(#f)"' : '') + '/></svg>'
    var url = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'
    var d = ['mask-image:' + url, 'mask-mode:luminance', 'mask-size:' + g.pw + 'px ' + g.ph + 'px', 'mask-repeat:no-repeat']
    if (!onElement) return d.concat('mask-position:0 0').join(';')
    // in the element's own coordinates: the picture starts where the wrapper does, and what the
    // element paints outside its box (overflowing text, its shadow) is masked, not cut off
    return d.concat('mask-position:' + -g.l + 'px ' + -g.t + 'px', 'mask-origin:border-box', 'mask-clip:no-clip')
      .map(function (x) { return x + ' !important' }).join(';')
  }
  /** the mask at output time t (its keyframed numbers between their keys) */
  function maskAt(o, t) {
    var m = Object.assign({}, o.mask)
    Object.keys(MASKPROPS).forEach(function (p) { if (keyed(o, p)) m[MASKPROPS[p]] = keyAt(o.keys[p], t, o.loops && o.loops[p]) })
    return m
  }
  function maskKeyed(o) { return !!o.mask && Object.keys(MASKPROPS).some(function (p) { return keyed(o, p) }) }
  var SHAPES = ':is(path,line,polyline,polygon,circle,ellipse,rect)'
  function buildRules(elements) {
    var typo = [], tf = []
    Object.keys(elements).forEach(function (id) {
      var o = elements[id] || {}
      if (id === CAMERA) {
        var cv = transformDecls(o)
        // about the middle of the picture; nothing scrolls when it moves past the edges
        if (cv.length) tf.push('html,body{overflow:hidden !important}\nbody{transform-origin:50vw 50vh;' + cv.join(';') + '}')
        return
      }
      var sel = '[data-ms-id="' + esc(id) + '"]', esel = sel + '[data-ms-id]', wsel = '[data-ms-wrap-for="' + esc(id) + '"]'
      var s = o.style || {}
      // ---- the element: type (passed down to what is inside it) and the box
      var decl = [], kids = []
      Object.keys(TYPO).forEach(function (k) {
        if (s[k] == null || s[k] === '') return
        var d = TYPO[k] + ':' + cssValue(k, s[k]) + ' !important'
        decl.push(d)
        if (k !== 'textAlign' && k !== 'textDecoration') kids.push(d)
      })
      ;[['color', 'color', '--ms-tc'], ['fontSize', 'font-size', '--ms-fs'], ['letterSpacing', 'letter-spacing', '--ms-ls'], ['lineHeight', 'line-height', '--ms-lh']].forEach(function (x) {
        if (!has(o, x[0])) return
        decl.push(vdecl(o, x[0]), x[1] + ':var(' + x[2] + ') !important')
        kids.push(x[1] + ':inherit !important')
      })
      if ((s.textStroke && num(s.textStroke.width, 0) > 0) || keyed(o, 'textStrokeWidth') || keyed(o, 'textStrokeColor')) {
        decl.push(vdecl(o, 'textStrokeWidth'), vdecl(o, 'textStrokeColor'), '-webkit-text-stroke:var(--ms-tsw) var(--ms-tsc) !important', 'paint-order:stroke fill !important')
        kids.push('-webkit-text-stroke:inherit !important', 'paint-order:stroke fill !important')
      }
      if (s.gradient || keyed(o, 'gradA') || keyed(o, 'gradB') || keyed(o, 'gradAngle')) {
        decl.push(vdecl(o, 'gradA'), vdecl(o, 'gradB'), vdecl(o, 'gradAngle'), 'background:linear-gradient(var(--ms-gang),var(--ms-ga),var(--ms-gb)) !important')
      } else if (has(o, 'fill')) decl.push(vdecl(o, 'fill'), 'background:var(--ms-fill) !important')
      if ((s.stroke && num(s.stroke.width, 0) > 0) || keyed(o, 'strokeWidth') || keyed(o, 'strokeColor')) {
        decl.push(vdecl(o, 'strokeWidth'), vdecl(o, 'strokeColor'), 'outline:var(--ms-sw) solid var(--ms-sc) !important', 'outline-offset:calc(-1 * var(--ms-sw)) !important')
      }
      if (has(o, 'radius')) decl.push(vdecl(o, 'radius'), 'border-radius:var(--ms-rad) !important', 'overflow:clip !important')
      if (o.trim || keyed(o, 'trimStart') || keyed(o, 'trimEnd')) {
        decl.push(vdecl(o, 'trimStart'), vdecl(o, 'trimEnd'))
        tf.push(sel + ' ' + SHAPES + ',' + sel + SHAPES + '{stroke-dasharray:max(0, calc(var(--ms-te) - var(--ms-ts))) 1000 !important;stroke-dashoffset:calc(-1 * var(--ms-ts)) !important}')
      }
      if (o.hidden) decl.push('visibility:hidden !important')
      if (o.deleted) decl.push('display:none !important')
      if (decl.length) typo.push(esel + '{' + decl.join(';') + '}')
      // compositions may split text into spans with their own sizes: force typography down the tree
      if (kids.length) typo.push(sel + ' *{' + kids.join(';') + '}')

      // ---- the wrapper: transform variables (keyframed ones are set by tweens), effects, mask
      var v = transformDecls(o)
      var fx = o.effects || {}
      if (fx.blend && fx.blend !== 'normal') v.push('mix-blend-mode:' + col(fx.blend))
      var fd = filterDecls(o)
      v = v.concat(fd.v)
      if (o.mask && GEO[id]) {
        var m0 = maskAt(o, 0)
        if (MASK_WRAP[id]) v.push(maskCss(m0, GEO[id], false))
        else tf.push(esel + '{' + maskCss(m0, GEO[id], true) + '}')
      }
      if (v.length) tf.push(wsel + '{' + v.join(';') + '}')
      if (num(o.motionBlur, 0) > 0) fd.filter = ('url(#' + blurId(id) + ') ' + fd.filter).trim()
      if (fd.filter) {
        // a layer filters itself; an adjustment layer filters whatever is behind it
        tf.push(wsel + ':not(:has(> [data-ms-type="adjustment"])){filter:' + fd.filter + '}')
        tf.push(sel + '[data-ms-type="adjustment"]{backdrop-filter:' + fd.filter + ' !important}')
      }
      // nested elements in normal flow move with relative offsets (layout is untouched)
      var t = o.transform || {}
      if (num(t.x, 0) || num(t.y, 0)) {
        tf.push(sel + '[data-ms-unwrappable]{position:relative !important;left:calc(var(--ms-l0, 0px) + ' + num(t.x, 0) + 'px) !important;top:calc(var(--ms-t0, 0px) + ' + num(t.y, 0) + 'px) !important}')
      }
    })
    // a layer used as another one's matte only shapes it (After Effects hides the matte layer)
    Object.keys(elements).forEach(function (id) {
      var mt = elements[id] && elements[id].matte
      if (mt && mt.layer) tf.push('[data-ms-wrap-for="' + esc(mt.layer) + '"]{visibility:hidden !important}')
    })
    return { typo: typo.join('\n'), tf: tf.join('\n') }
  }
  function blurId(id) { return 'msmb-' + String(id).replace(/[^\w-]/g, '_') }
  function styleTag(id) {
    var st = document.getElementById(id)
    if (!st) {
      st = document.createElement('style')
      st.id = id
      ;(document.head || document.documentElement).appendChild(st)
    }
    return st
  }
  function applyStyles(elements) {
    var r = buildRules(elements)
    styleTag('ms-overrides-base').textContent = BASE
    styleTag('ms-overrides-css').textContent = r.typo
    styleTag('ms-overrides-transform').textContent = r.tf
  }
  applyStyles(EL)

  // ---- 1b. edit wrappers ------------------------------------------------------
  var wrapped = false
  /** the composition root as a group ("__root": the layers directly in it, set free together) */
  var ROOT_GROUP = '__root'
  function groupEl(gid) { return gid === ROOT_GROUP ? document.querySelector('[data-composition-id]') : document.querySelector('[data-ms-id="' + esc(gid) + '"]') }
  /** groups set free by the designer: their editable children placed where they were measured */
  function applyFreeze() {
    Object.keys(FREEZE).forEach(function (gid) {
      var f = FREEZE[gid] || {}, g = groupEl(gid)
      if (!g || !f.kids) return
      if (getComputedStyle(g).position === 'static') g.style.setProperty('position', 'relative', 'important')
      if (f.size) {
        g.style.setProperty('width', num(f.size.w, g.offsetWidth) + 'px', 'important')
        g.style.setProperty('height', num(f.size.h, g.offsetHeight) + 'px', 'important')
      }
      Object.keys(f.kids).forEach(function (kid) {
        var k = document.querySelector('[data-ms-id="' + esc(kid) + '"]'), b = f.kids[kid]
        if (!k || !b) return
        ;[['position', 'absolute'], ['left', num(b.l, 0) + 'px'], ['top', num(b.t, 0) + 'px'], ['width', num(b.w, 0) + 'px'], ['height', num(b.h, 0) + 'px'],
          ['margin', '0'], ['box-sizing', 'border-box'], ['right', 'auto'], ['bottom', 'auto'], ['transform-origin', 'center']].forEach(function (d) { k.style.setProperty(d[0], d[1], 'important') })
      })
    })
  }
  /** where the editable children of a group are laid out now (px in the group), to set them free */
  function measureFlow(gid) {
    var g = groupEl(gid)
    if (!g) return { error: 'no group' }
    var was = g.style.getPropertyValue('position'), prio = g.style.getPropertyPriority('position')
    var stat = getComputedStyle(g).position === 'static'
    if (stat) g.style.setProperty('position', 'relative')
    var kids = {}
    try {
      var list = g.querySelectorAll('[data-ms-id]')
      for (var i = 0; i < list.length; i++) {
        var k = list[i]
        // the composition root: only the layers right in it (one inside an unnamed box would leave that box behind)
        if (gid === ROOT_GROUP ? k.parentElement !== g : k.parentElement.closest('[data-ms-id]') !== g) continue
        if (k.closest('svg')) continue
        var cs = getComputedStyle(k)
        if (cs.position === 'absolute' || cs.position === 'fixed') continue
        if (k.offsetParent !== g) continue
        kids[k.getAttribute('data-ms-id')] = { l: k.offsetLeft, t: k.offsetTop, w: k.offsetWidth, h: k.offsetHeight }
      }
    } finally {
      if (stat) { if (was) g.style.setProperty('position', was, prio); else g.style.removeProperty('position') }
    }
    return { group: gid, size: { w: g.offsetWidth, h: g.offsetHeight }, kids: kids }
  }
  /** one editable element in its own wrapper (moves and effects go there), unless it sits in a layout */
  function wrapOne(el) {
    if (el.parentElement && el.parentElement.hasAttribute('data-ms-wrap-for')) return
    var cs = getComputedStyle(el)
    if (cs.position !== 'absolute' && cs.position !== 'fixed') {
      if (cs.position === 'relative') {
        // keep the authored offset; designer moves add to it
        el.style.setProperty('--ms-l0', cs.left === 'auto' ? '0px' : cs.left)
        el.style.setProperty('--ms-t0', cs.top === 'auto' ? '0px' : cs.top)
      }
      el.setAttribute('data-ms-unwrappable', cs.position)
      return
    }
    var id = el.getAttribute('data-ms-id')
    var w = document.createElement('div')
    w.setAttribute('data-ms-wrap-for', id)
    w.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;'
    if (cs.zIndex !== 'auto') w.style.zIndex = cs.zIndex
    // a 3D scene keeps its depth through the wrapper: a parent in preserve-3d passes the 3D space on
    // (its perspective already reaches the element through the wrapper — copying it would apply it twice);
    // a flat parent's perspective only reaches its children, so the wrapper takes it over
    var pcs = getComputedStyle(el.parentNode)
    if (pcs.transformStyle === 'preserve-3d') w.style.transformStyle = 'preserve-3d'
    else if (pcs.perspective && pcs.perspective !== 'none') {
      w.style.perspective = pcs.perspective
      w.style.perspectiveOrigin = pcs.perspectiveOrigin
    }
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
      w.style.setProperty('--ms-cb', cs.mixBlendMode)
      el.style.setProperty('mix-blend-mode', 'normal', 'important')
    }
    el.parentNode.insertBefore(w, el)
    w.appendChild(el)
    // pivot designer scale/rotate on the element's untransformed centre (+ the designer's anchor)
    w.style.setProperty('--ms-cx', (el.offsetLeft + el.offsetWidth / 2) + 'px')
    w.style.setProperty('--ms-cy', (el.offsetTop + el.offsetHeight / 2) + 'px')
    GEO[id] = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, pw: w.offsetWidth || 1, ph: w.offsetHeight || 1 }
    if ((cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none')) MASK_WRAP[id] = 1
  }
  function wrapEditables() {
    if (wrapped) return
    wrapped = true
    try { if (autoIds()) scan(document.body) } catch (e) { /* layers of their own are best effort */ }
    try { applyFreeze() } catch (e) { /* free layout is best effort */ }
    var list = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) wrapOne(list[i])
    try { wrapParts() } catch (e) { /* character parts are best effort */ }
    try { trimAttrs() } catch (e) { /* line drawing is best effort */ }
    try { moveToGroups() } catch (e) { /* moving between groups is best effort */ }
    // after wrapping: moving an element in the page starts its CSS animations again
    try { cssAnimations() } catch (e) { /* CSS animation edits are best effort */ }
    // masks need the measured boxes
    applyStyles(EL)
  }
  /**
   * A layer moved into another group (it stacks, clips and moves with that group now): it stays
   * where it was on screen, the difference becomes an offset of its wrapper.
   */
  function moveToGroups() {
    Object.keys(EL).forEach(function (id) {
      var gid = EL[id] && EL[id].moveTo
      if (!gid) return
      var el = document.querySelector('[data-ms-id="' + esc(id) + '"]'), g = document.querySelector('[data-ms-id="' + esc(gid) + '"]')
      var w = el && wrapperOf(el)
      if (!w || !g || el.contains(g) || g.contains(w)) return
      if (getComputedStyle(g).position === 'static') g.style.setProperty('position', 'relative', 'important')
      var before = el.getBoundingClientRect()
      g.appendChild(w)
      var after = el.getBoundingClientRect()
      w.style.setProperty('--ms-gx', (before.left - after.left) + 'px')
      w.style.setProperty('--ms-gy', (before.top - after.top) + 'px')
    })
  }
  /**
   * CSS animations of editable layers (keyframes in the composition's stylesheet): listed with
   * the motions and edited the same way — start, length, easing, off. The renderer seeks every
   * animation of the page, so new timing holds in the export too.
   */
  var CSSANIMS = []
  var CSS_EASE = { none: 'linear', linear: 'linear' }
  function cssEasing(e) {
    if (CSS_EASE[e]) return CSS_EASE[e]
    if (/^cubic-bezier\(/.test(e) || /^(ease|ease-in|ease-out|ease-in-out|linear|steps)/.test(e)) return e
    var dir = /\.inOut/.test(e) ? 'ease-in-out' : /\.in\b/.test(e) ? 'ease-in' : 'ease-out'
    return dir
  }
  function cssAnimations() {
    if (!document.getAnimations || typeof CSSAnimation === 'undefined') return
    var count = {}
    document.getAnimations().forEach(function (a) {
      if (!(a instanceof CSSAnimation) || !a.effect || !a.effect.target) return
      var target = a.effect.target, owner = ownerId(target)
      if (!owner) return
      var name = a.animationName, nk = owner + '@' + name
      var n = (count[nk] = (count[nk] || 0) + 1)
      var key = nk + '#' + n, sig = 'css:' + name
      var tm = a.effect.getTiming()
      var rec = {
        key: key, editKey: null, owners: [owner], self: target.getAttribute('data-ms-id') === owner ? owner : null, type: 'css', sig: sig,
        props: [{ name: 'CSS ' + name, editable: false }], ease: String(tm.easing || 'ease'), duration: num(tm.duration, 0) / 1000,
        stagger: false, staggerEach: null, staggerFrom: 'start', repeat: tm.iterations === Infinity ? 999 : Math.max(0, num(tm.iterations, 1) - 1), yoyo: false,
        shift: 0, edited: false, disabled: false, tween: null, delay0: num(tm.delay, 0) / 1000,
      }
      var o = MO[key]
      if (o && o.sig === sig) {
        rec.edited = true
        rec.editKey = key
        rec.shift = +o.shift || 0
        if (o.disabled) { a.effect.updateTiming({ iterations: 0, fill: 'none' }); rec.disabled = true }
        else {
          var t2 = {}
          if (rec.shift) t2.delay = (rec.delay0 + rec.shift) * 1000
          if (typeof o.duration === 'number' && o.duration > 0) { t2.duration = o.duration * 1000; rec.duration = o.duration }
          if (o.ease) t2.easing = cssEasing(o.ease)
          a.effect.updateTiming(t2)
        }
      }
      // the designer moved the whole layer: its CSS animation moves too
      var ls = LAYER_SHIFT[owner] != null ? LAYER_SHIFT[owner] : layerShift(owner)
      if (ls && !rec.disabled) {
        a.effect.updateTiming({ delay: Math.max(0, rec.delay0 + rec.shift + ls) * 1000 })
        rec.layerShift = ls
      }
      rec.authored = rec.delay0
      var iters = tm.iterations === Infinity ? 1 : num(tm.iterations, 1)
      rec.start = Math.max(0, rec.delay0 + rec.shift + (rec.layerShift || 0))
      rec.end = rec.start + rec.duration * iters
      CSSANIMS.push(rec)
    })
    Object.keys(MO).forEach(function (k) {
      var o = MO[k]
      if (o && String(o.sig).indexOf('css:') === 0 && !CSSANIMS.some(function (c) { return c.key === k })) STALE.push(k)
    })
  }
  /**
   * Character parts (tagged <g data-pivot> in a character's drawing) are layers too: each gets a
   * wrapper <g> that turns about the part's pivot, in the drawing's own units, on top of the pose
   * Claude's acting gives it. Parts inside parts follow their parent.
   */
  var PARTS = {}
  var SVGNS = 'http://www.w3.org/2000/svg'
  function wrapParts() {
    var hosts = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i], hid = host.getAttribute('data-ms-id')
      if (host.closest('svg')) continue
      var parts = host.querySelectorAll('svg [data-pivot][id]')
      for (var j = 0; j < parts.length; j++) {
        var g = parts[j]
        if (g.closest('[data-ms-id]') !== host) continue
        var pid = hid + '::' + g.id
        if (PARTS[pid]) continue
        var pv = String(g.getAttribute('data-pivot') || '').trim().split(/[\s,]+/).map(Number)
        var w = document.createElementNS(SVGNS, 'g')
        w.setAttribute('data-ms-wrap-for', pid)
        w.setAttribute('data-ms-part', pid)
        w.style.setProperty('--ms-cx', (pv[0] || 0) + 'px')
        w.style.setProperty('--ms-cy', (pv[1] || 0) + 'px')
        g.parentNode.insertBefore(w, g)
        w.appendChild(g)
        PARTS[pid] = { host: hid, el: g, wrap: w, label: g.getAttribute('data-label') || g.id, pivot: [pv[0] || 0, pv[1] || 0] }
      }
    }
  }
  /** strokes a layer draws on (After Effects' Trim Paths) measure 100 long */
  function trimAttrs() {
    Object.keys(EL).forEach(function (id) {
      var o = EL[id] || {}
      if (!o.trim && !keyed(o, 'trimStart') && !keyed(o, 'trimEnd')) return
      var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
      if (!el) return
      var shapes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect')))
      shapes.forEach(function (n) { if (n.namespaceURI === SVGNS && /^(path|line|polyline|polygon|circle|ellipse|rect)$/.test(n.localName)) n.setAttribute('pathLength', '100') })
    })
  }

  // ---- 2. text and media overrides (before the composition's scripts run) ------------
  /** the text nodes of an element that show something, in order (parts of a styled line: runs) */
  function textNodes(el) {
    var out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      var pe = n.parentElement
      if (!n.nodeValue.trim() || (pe && /^(SCRIPT|STYLE)$/.test(pe.tagName))) continue
      out.push(n)
    }
    return out
  }
  function applyText(el) {
    var o = EL[el.getAttribute('data-ms-id')]
    if (!o || el.__msTextApplied) return
    if (o.textRuns && o.textRuns.length) {
      // each part of a styled line keeps its style (a word in another colour stays so)
      el.__msTextApplied = true
      textNodes(el).forEach(function (n, i) { if (o.textRuns[i] != null) n.nodeValue = String(o.textRuns[i]) })
    } else if (o.text != null) {
      el.__msTextApplied = true
      // a text with parts inside (a highlight bar, a styled word, a box around the words): only the
      // characters that changed are replaced, so the parts — and the size they give — stay
      if (!hasParts(el) || !editInPlace(el, String(o.text))) {
        el.textContent = ''
        String(o.text).split('\n').forEach(function (line, i) {
          if (i) el.appendChild(document.createElement('br'))
          el.appendChild(document.createTextNode(line))
        })
      }
    }
    if (o.highlights && o.highlights.length && !el.__msHighlighted) {
      el.__msHighlighted = true
      o.highlights.forEach(highlight.bind(null, el))
    }
  }
  /** inside the text: elements other than line breaks */
  function hasParts(el) {
    for (var i = 0; i < el.children.length; i++) if (el.children[i].tagName !== 'BR') return true
    return false
  }
  /**
   * The designer's new words put into the text's own parts: the characters that differ from the
   * page's (spaces and line breaks aside) replace them where they are; a new line break becomes <br>.
   * False when it cannot be done that way (a removed line break, no text): the text is then replaced.
   */
  function editInPlace(el, text) {
    var chars = [], before = ''
    textNodes(el).forEach(function (n) {
      var v = n.nodeValue
      for (var i = 0; i < v.length; i++) if (!/\s/.test(v[i])) { chars.push({ n: n, i: i }); before += v[i] }
    })
    if (!chars.length) return false
    var at = [], after = ''
    for (var j = 0; j < text.length; j++) if (!/\s/.test(text[j])) { at.push(j); after += text[j] }
    // line breaks: where they fall between characters (counted without spaces)
    var breaksOf = function (t) {
      var out = {}, k = 0
      for (var m = 0; m < t.length; m++) {
        if (t[m] === '\n') out[k] = 1
        else if (!/\s/.test(t[m])) k++
      }
      return out
    }
    var was = breaksOf(el.innerText || ''), now = breaksOf(text)
    for (var w in was) if (!now[w] && +w > 0 && +w < before.length) return false
    // what changed, character by character (a common-subsequence diff): each changed stretch is
    // replaced where it is, so an edit inside a styled word stays inside it
    var n0 = before.length, m0 = after.length
    if (n0 * m0 > 4000000) return false
    var L = []
    for (var i1 = 0; i1 <= n0; i1++) L.push(new Uint16Array(m0 + 1))
    for (var a1 = n0 - 1; a1 >= 0; a1--) for (var b1 = m0 - 1; b1 >= 0; b1--) L[a1][b1] = before[a1] === after[b1] ? L[a1 + 1][b1 + 1] + 1 : Math.max(L[a1 + 1][b1], L[a1][b1 + 1])
    var hunks = [], x = 0, y = 0, open = null
    while (x < n0 || y < m0) {
      if (x < n0 && y < m0 && before[x] === after[y]) {
        if (open) hunks.push(open), (open = null)
        x++, y++
      } else {
        if (!open) open = { i0: x, i1: x, j0: y, j1: y }
        if (y < m0 && (x === n0 || L[x][y + 1] >= L[x + 1][y])) open.j1 = ++y
        else open.i1 = ++x
      }
    }
    if (open) hunks.push(open)
    // the later ones first: changing a part keeps the offsets before it
    for (var h = hunks.length - 1; h >= 0; h--) {
      var k = hunks[h]
      var put = k.j0 < k.j1 ? text.slice(at[k.j0], at[k.j1 - 1] + 1).replace(/\n/g, ' ') : ''
      if (k.i0 < k.i1) {
        // the changed characters go from each part they are in; the new ones take the first one's place
        var segs = []
        for (var c = k.i0; c < k.i1; c++) {
          var g = segs[segs.length - 1]
          if (g && g.n === chars[c].n) g.b = chars[c].i + 1
          else segs.push({ n: chars[c].n, a: chars[c].i, b: chars[c].i + 1 })
        }
        for (var sg = segs.length - 1; sg >= 0; sg--) {
          var v = segs[sg].n.nodeValue
          segs[sg].n.nodeValue = v.slice(0, segs[sg].a) + (sg === 0 ? put : '') + v.slice(segs[sg].b)
        }
      } else if (put) {
        // only added: right after the character before it (or before the first one)
        var ref = k.i0 > 0 ? chars[k.i0 - 1] : chars[0]
        var v2 = ref.n.nodeValue
        var cut = k.i0 > 0 ? ref.i + 1 : ref.i
        ref.n.nodeValue = v2.slice(0, cut) + put + v2.slice(cut)
      }
    }
    // a new line break between two characters: a <br> there
    var added = Object.keys(now).filter(function (k) { return !was[k] && +k > 0 && +k < after.length })
    if (added.length) {
      var now2 = [], s2 = ''
      textNodes(el).forEach(function (n) {
        var v = n.nodeValue
        for (var i = 0; i < v.length; i++) if (!/\s/.test(v[i])) { now2.push({ n: n, i: i }); s2 += v[i] }
      })
      added.sort(function (a, b) { return b - a }).forEach(function (k) {
        var c3 = now2[+k]
        if (!c3) return
        var rest = c3.n.splitText(c3.i)
        rest.parentNode.insertBefore(document.createElement('br'), rest)
      })
    }
    return true
  }
  /** a word (or phrase) of a text in its own colour / weight: every place it appears (or one, nth) */
  function highlight(el, h) {
    var word = String(h && h.text || '')
    if (!word) return
    if (typeof h.nth === 'number') return highlightAt(el, h)
    textNodes(el).forEach(function (n) {
      var node = n
      for (var guard = 0; guard < 50; guard++) {
        var at = node.nodeValue.indexOf(word)
        if (at < 0) return
        var mid = node.splitText(at), rest = mid.splitText(word.length)
        wrapHighlight(mid, h)
        node = rest
      }
    })
  }
  function wrapHighlight(node, h) {
    var span = document.createElement('span')
    span.setAttribute('data-ms-highlight', '')
    if (h.color) span.style.setProperty('color', col(h.color), 'important')
    if (h.weight) span.style.setProperty('font-weight', String(num(h.weight, 700)), 'important')
    if (h.underline) span.style.setProperty('text-decoration', 'underline', 'important')
    node.parentNode.insertBefore(span, node)
    span.appendChild(node)
  }
  /**
   * The part the designer dragged over: the nth place of the text, matched without spaces and line
   * breaks (the text box shows them differently from the page), across styled parts and lines.
   */
  function highlightAt(el, h) {
    var needle = String(h.text).replace(/\s+/g, '')
    if (!needle) return
    var chars = [], s = ''
    textNodes(el).forEach(function (n) {
      var v = n.nodeValue
      for (var i = 0; i < v.length; i++) if (!/\s/.test(v[i])) { chars.push({ n: n, i: i }); s += v[i] }
    })
    // counted without overlaps, as the editor counts
    var at = -1, from = 0
    for (var k = 0; k <= Math.max(0, Math.floor(h.nth)); k++) {
      at = s.indexOf(needle, from)
      if (at < 0) return
      from = at + needle.length
    }
    // from its first to its last character in each text node (spaces between them included)
    var segs = []
    for (var j = at; j < at + needle.length; j++) {
      var c = chars[j], last = segs[segs.length - 1]
      if (last && last.n === c.n) last.b = c.i + 1
      else segs.push({ n: c.n, a: c.i, b: c.i + 1 })
    }
    // the later parts first: splitting a node keeps the earlier offsets
    for (var q = segs.length - 1; q >= 0; q--) {
      var g = segs[q], mid = g.a ? g.n.splitText(g.a) : g.n
      if (g.b - g.a < mid.nodeValue.length) mid.splitText(g.b - g.a)
      wrapHighlight(mid, h)
    }
  }
  function mediaOf(el) {
    if (/^(IMG|VIDEO)$/.test(el.tagName)) return el
    return el.querySelector('img,video')
  }
  function applySrc(el) {
    var o = EL[el.getAttribute('data-ms-id')]
    if (!o || !o.src || el.__msSrcApplied) return
    var m = mediaOf(el)
    if (!m) return
    el.__msSrcApplied = true
    var sources = m.querySelectorAll('source')
    for (var i = 0; i < sources.length; i++) sources[i].parentNode.removeChild(sources[i])
    m.setAttribute('src', String(o.src))
    if (m.tagName === 'IMG') m.removeAttribute('srcset')
  }
  function applyContent(el) {
    applyText(el)
    applySrc(el)
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return
    if (root.hasAttribute('data-ms-id')) applyContent(root)
    var list = root.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) applyContent(list[i])
  }
  /**
   * A plain coloured box: something painted (a fill, a picture background, a border or a shadow)
   * with no text or pictures inside — the pill behind a label, a divider, a colour block.
   */
  function plainBox(e) {
    if (/^(IMG|VIDEO|CANVAS|PICTURE|svg|SVG)$/.test(e.tagName) || e.querySelector('img,video,canvas,svg,picture,[data-ms-id]')) return false
    if ((e.textContent || '').replace(/\s+/g, '').length) return false
    var r = e.getBoundingClientRect()
    if (r.width < 6 || r.height < 6) return false
    var cs = getComputedStyle(e)
    var seen = function (c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return !!c && c !== 'transparent'; var a = m[1].split(',')[3]; return a == null || parseFloat(a) > 0 }
    return seen(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && seen(cs.borderTopColor)) || (cs.boxShadow && cs.boxShadow !== 'none')
  }
  /**
   * Text, pictures and plain coloured boxes inside a group that Claude left without a data-ms-id of
   * their own (a phone mockup's copy, the pill behind a label) are layers too: they get an id from
   * where they sit in the group ("<group>~<path>"), the same every time as long as the group keeps
   * its shape.
   */
  var autoDone = false
  /** boxes: false while the page is still being read (an element's text may not be there yet) */
  function autoIds(boxes) {
    var made = 0
    var groups = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i]
      if (g.closest('svg') || /^(AUDIO|VIDEO|IMG)$/.test(g.tagName)) continue
      if (g.getAttribute('data-ms-type') !== 'group' && !g.querySelector('[data-ms-id]')) continue
      var gid = g.getAttribute('data-ms-id')
      var all = g.querySelectorAll('*')
      for (var j = 0; j < all.length; j++) {
        var e = all[j]
        if (e.hasAttribute('data-ms-id') || e.closest('svg') || /^(SCRIPT|STYLE|BR|SOURCE|AUDIO)$/.test(e.tagName)) continue
        if (e.parentElement.closest('[data-ms-id]') !== g) continue
        var pic = /^(IMG|VIDEO)$/.test(e.tagName) || (e.tagName.toLowerCase() === 'svg')
        var own = ''
        for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.nodeValue
        own = own.replace(/\s+/g, ' ').trim()
        var box = !pic && !own && boxes !== false && plainBox(e)
        if (!pic && !own && !box) continue
        var path = []
        for (var n = e; n && n !== g; n = n.parentElement) path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n))
        e.setAttribute('data-ms-id', gid + '~' + path.join('.'))
        e.setAttribute('data-ms-auto', '')
        if (!e.hasAttribute('data-ms-label')) e.setAttribute('data-ms-label', pic ? '그림' : box ? '상자' : own.slice(0, 16))
        if (!e.hasAttribute('data-ms-type')) e.setAttribute('data-ms-type', pic ? (e.tagName === 'VIDEO' ? 'video' : 'image') : box ? 'shape' : 'text')
        made++
      }
    }
    autoDone = true
    return made
  }
  var hasContent = Object.keys(EL).some(function (id) { return EL[id] && (EL[id].text != null || EL[id].src || EL[id].textRuns || EL[id].highlights) })
  var hasAuto = Object.keys(EL).some(function (id) { return id.indexOf('~') > 0 })
  if (hasContent || hasAuto) {
    // Mutation records are delivered at the microtask checkpoint the parser
    // performs before executing each <script>, i.e. before authored code runs.
    var mo = new MutationObserver(function (recs) {
      // layers that got an id of their own now take their text too
      if (hasAuto && autoIds(false)) scan(document.body)
      recs.forEach(function (r) { r.addedNodes.forEach(scan) })
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', function () { if (hasAuto) autoIds(); scan(document.body); mo.disconnect() })
  }

  // ---- 2b. duplicates and stacking order (when the main timeline registers) ------------
  function mainRoot() { return document.querySelector('[data-composition-id]') }
  var prepped = false
  var stackSeq = 0
  /** every parent of editable elements gets a stable key: the stacking group of its children */
  function markStacks(root) {
    var list = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) {
      var p = list[i].parentElement
      if (!p || p.hasAttribute('data-ms-stack')) continue
      var key = p === root ? '' : p.getAttribute('data-ms-id') || (p.id ? '#' + p.id : 'p' + (++stackSeq))
      p.setAttribute('data-ms-stack', key)
    }
  }
  function pathTo(root, node) {
    var path = []
    for (var n = node; n && n !== root; n = n.parentElement) {
      var p = n.parentElement
      if (!p) return null
      path.unshift(Array.prototype.indexOf.call(p.children, n))
    }
    return n === root ? path : null
  }
  function follow(root, path) {
    var n = root
    for (var i = 0; n && i < path.length; i++) n = n.children[path[i]]
    return n || null
  }
  function duplicate(tl, d) {
    var orig = document.querySelector('[data-ms-id="' + esc(d.of) + '"]')
    if (!orig || !orig.parentNode || document.querySelector('[data-ms-id="' + esc(d.id) + '"]')) return
    var copy = orig.cloneNode(true)
    copy.setAttribute('data-ms-id', d.id)
    copy.setAttribute('data-ms-copy-of', d.of)
    var nested = copy.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < nested.length; i++) nested[i].setAttribute('data-ms-id', nested[i].getAttribute('data-ms-id') + '@' + d.id)
    // two clips of one file would be decoded twice: a copied clip keeps the picture it has
    var media = copy.querySelectorAll('video,audio')
    for (var j = 0; j < media.length; j++) media[j].removeAttribute('id')
    orig.parentNode.insertBefore(copy, orig.nextSibling)
    scan(copy)
    // every tween of the original (and of what is inside it) again, for the copy
    tl.getChildren(true, true, false).forEach(function (tw) {
      var mapped = []
      tw.targets().forEach(function (t) {
        if (!t || t.nodeType !== 1 || (t !== orig && !orig.contains(t))) return
        var path = pathTo(orig, t)
        var c = path && follow(copy, path)
        if (c) mapped.push(c)
      })
      if (!mapped.length || !tw.parent) return
      var vars = Object.assign({}, tw.vars)
      delete vars.id
      var silent = !(tw.duration() > 0)
      CAPTURE_OFF = silent
      try {
        tw.parent.add(window.gsap.to(mapped.length === 1 ? mapped[0] : mapped, vars), tw.startTime())
      } catch (e) { /* best effort */ }
      CAPTURE_OFF = false
    })
  }
  /** the designer's stacking order: siblings swap places, everything else keeps its slot */
  function applyOrder() {
    Object.keys(ORDER).forEach(function (key) {
      var ids = ORDER[key] || []
      var byParent = []
      ids.forEach(function (id) {
        var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
        if (!el || !el.parentElement) return
        var g = byParent.filter(function (x) { return x.p === el.parentElement })[0]
        if (!g) byParent.push((g = { p: el.parentElement, wanted: [] }))
        g.wanted.push(el)
      })
      byParent.forEach(function (g) {
        if (g.wanted.length < 2) return
        // slots in document order (bottom of the stack first)
        var slots = g.wanted.slice().sort(function (a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1 })
        var marks = slots.map(function (el) { var c = document.createComment('ms-slot'); g.p.insertBefore(c, el); return c })
        slots.forEach(function (el) { g.p.removeChild(el) })
        // wanted is top first: the bottom one takes the first slot
        var bottomUp = g.wanted.slice().reverse()
        bottomUp.forEach(function (el, i) { g.p.insertBefore(el, marks[i]) })
        marks.forEach(function (c) { g.p.removeChild(c) })
        // explicit z-index among them would beat document order: give them all one
        var zs = bottomUp.map(function (el) { return getComputedStyle(el).zIndex })
        if (zs.some(function (z) { return z !== 'auto' })) {
          var base = Math.min.apply(null, zs.filter(function (z) { return z !== 'auto' }).map(Number).concat([1]))
          bottomUp.forEach(function (el, i) { el.style.setProperty('z-index', String(base + i), 'important') })
        }
      })
    })
  }
  /** text animator: the element's letters (or words) as inline-block spans */
  var SPLIT = {}
  function splitText(el, by) {
    var parts = []
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    var nodes = []
    for (var n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
    nodes.forEach(function (node) {
      var text = node.nodeValue
      if (!text || !text.trim() || (node.parentElement && /^(SCRIPT|STYLE)$/.test(node.parentElement.tagName))) return
      var frag = document.createDocumentFragment()
      var pieces = by === 'word' ? text.split(/(\s+)/) : Array.from(text)
      pieces.forEach(function (p) {
        if (!p) return
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return }
        var span = document.createElement('span')
        span.className = 'ms-ta'
        span.style.display = 'inline-block'
        span.style.whiteSpace = 'pre'
        span.textContent = p
        frag.appendChild(span)
        parts.push(span)
      })
      node.parentNode.replaceChild(frag, node)
    })
    return parts
  }
  function prepTextAnims() {
    Object.keys(EL).forEach(function (id) {
      var a = EL[id] && EL[id].textAnim
      if (!a || !a.preset) return
      var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
      if (el) SPLIT[id] = splitText(el, a.by === 'word' ? 'word' : 'char')
    })
  }
  var TA = {
    fadeUp: [{ opacity: 0, y: '0.6em' }, { opacity: 1, y: 0, ease: 'power3.out' }],
    typewriter: [{ opacity: 0 }, { opacity: 1, ease: 'none' }],
    pop: [{ opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, ease: 'back.out(2.5)' }],
    slideLeft: [{ opacity: 0, x: '0.8em' }, { opacity: 1, x: 0, ease: 'power3.out' }],
    blurIn: [{ opacity: 0, filter: 'blur(12px)' }, { opacity: 1, filter: 'blur(0px)', ease: 'power2.out' }],
  }
  /** the designer's own text animator: where each letter comes from (After Effects' animator properties) */
  function customTA(c) {
    c = c || {}
    var from = { opacity: c.opacity != null ? num(c.opacity, 0) : 0 }, to = { opacity: 1, ease: easeOf(c.ease || 'power3.out') }
    if (num(c.x, 0)) { from.x = num(c.x, 0); to.x = 0 }
    if (num(c.y, 0)) { from.y = num(c.y, 0); to.y = 0 }
    if (c.scale != null && num(c.scale, 1) !== 1) { from.scale = num(c.scale, 1); to.scale = 1 }
    if (num(c.rotate, 0)) { from.rotation = num(c.rotate, 0); to.rotation = 0 }
    if (num(c.blur, 0)) { from.filter = 'blur(' + num(c.blur, 0) + 'px)'; to.filter = 'blur(0px)' }
    if (c.color) { from.color = col(c.color) }
    return [from, to]
  }
  function addTextAnims(T) {
    Object.keys(SPLIT).forEach(function (id) {
      var a = EL[id] && EL[id].textAnim
      var parts = SPLIT[id]
      if (!a || !parts || !parts.length) return
      var start = Math.max(0, +a.start || 0), dur = Math.max(0.01, +a.duration || 0.4), stagger = Math.max(0, +a.stagger || 0.04)
      if (a.preset === 'custom') {
        var cp = customTA(a.custom)
        var order = a.order === 'end' ? 'end' : a.order === 'center' ? 'center' : a.order === 'edges' ? 'edges' : 'start'
        T.set(parts, cp[0], 0)
        T.fromTo(parts, Object.assign({}, cp[0]), Object.assign({ duration: dur, stagger: { each: stagger, from: order }, immediateRender: false }, cp[1]), start)
        return
      }
      if (a.preset === 'typewriter') dur = 0.01
      if (a.preset === 'wave') {
        T.fromTo(parts, { y: 0 }, { y: '-0.35em', duration: dur / 2, stagger: stagger, yoyo: true, repeat: 1, ease: 'sine.inOut', immediateRender: false }, start)
        return
      }
      var p = TA[a.preset]
      if (!p) return
      T.set(parts, p[0], 0)
      T.fromTo(parts, Object.assign({}, p[0]), Object.assign({ duration: dur, stagger: stagger, immediateRender: false }, p[1]), start)
    })
  }
  function prep(tl) {
    if (prepped) return
    prepped = true
    var root = mainRoot()
    try { prepTextAnims() } catch (e) { /* text animators are best effort */ }
    markStacks(root)
    DUPS.forEach(function (d) { try { duplicate(tl, d) } catch (e) { /* best effort */ } })
    markStacks(root)
    try { applyOrder() } catch (e) { /* best effort */ }
    try { markAuthoredMasks(tl) } catch (e) { /* best effort */ }
  }
  /** elements whose mask Claude's timeline animates keep the designer's mask on their wrapper */
  function markAuthoredMasks(tl) {
    var changed = false
    tl.getChildren(true, true, false).forEach(function (tw) {
      var v = tw.vars || {}
      var props = Object.keys(v).concat(Object.keys(v.startAt || {}))
      if (!props.some(function (k) { return /mask/i.test(k) })) return
      tw.targets().forEach(function (t) {
        var id = t && t.nodeType === 1 && t.getAttribute('data-ms-id')
        if (id && !MASK_WRAP[id]) { MASK_WRAP[id] = 1; changed = true }
      })
    })
    if (changed) applyStyles(EL)
  }

  // ---- 3. timeline overrides ------------------------------------------------
  function ownerId(target) {
    if (!target || target.nodeType !== 1 || !target.closest) return null
    var host = target.closest('[data-ms-id]')
    return host ? host.getAttribute('data-ms-id') : null
  }
  /** the layers a tween animates (its targets' nearest named elements), first target first */
  function tweenOwners(tw) {
    var ids = []
    tw.targets().forEach(function (t) { var id = ownerId(t); if (id && ids.indexOf(id) < 0) ids.push(id) })
    return ids
  }
  function layerShift(id) { var o = EL[id]; return o && o.timing ? +o.timing.shift || 0 : 0 }
  /** a set at the very start (an initial state such as autoAlpha:0) belongs to no moment: it stays */
  function initialSet(tw, tl) { return tw.duration() === 0 && globalStart(tw, tl) <= 1e-6 }
  /** per-target start offsets of a staggered tween (GSAP's own distribution), null when not staggered */
  function staggerOffsets(tw) {
    var st = tw.vars && tw.vars.stagger, list = tw.targets()
    if (st == null || list.length < 2 || !window.gsap) return null
    try {
      var f = typeof st === 'function' ? st : window.gsap.utils.distribute(typeof st === 'number' ? { each: st } : st)
      return list.map(function (t, i) { return +f(i, t, list) || 0 })
    } catch (e) { return null }
  }
  /** a tween's place in its parent, moved by s seconds of the main timeline */
  function moveTween(tw, tl, s) {
    var k = 1
    for (var p = tw.parent; p && p !== tl; p = p.parent) k *= p.timeScale() || 1
    // never before the start of the scene it sits in (GSAP would move the whole scene)
    tw.startTime(Math.max(0, tw.startTime() + s * k))
    tw.__msShifted = true
  }
  /**
   * One tween animates layers the designer moved by different amounts: it becomes one tween per
   * target (the stagger kept as each target's own offset), each moved with its layer.
   */
  function splitTween(tw, tl, eff) {
    var parent = tw.parent, list = tw.targets(), v = tw.vars || {}
    if (!parent || typeof parent.add !== 'function' || !window.gsap || !list.length) return
    // a stagger that repeats as a whole cannot become separate tweens with the same rhythm: it stays
    if (v.stagger != null && v.repeat) return
    var offs = staggerOffsets(tw) || list.map(function () { return 0 })
    // the tween's place already counts its delay; offsets are in the tween's own (sped-up) time
    var at = tw.startTime(), speed = tw.timeScale() || 1
    var per = v.stagger && typeof v.stagger === 'object' ? v.stagger : null
    var k = 1
    for (var p = parent; p && p !== tl; p = p.parent) k *= p.timeScale() || 1
    // a from / fromTo tween already drew its start values: back to the values before it, so the
    // copies read the same end values the original did
    try { if (tw.revert) tw.revert(); else tw.kill() } catch (e) { tw.kill() }
    var wasOff = CAPTURE_OFF
    CAPTURE_OFF = true
    var made = []
    try {
      list.forEach(function (t, i) {
        var c = {}
        Object.keys(v).forEach(function (key) { if (key !== 'stagger' && key !== 'delay') c[key] = v[key] })
        if (v.startAt) c.startAt = Object.assign({}, v.startAt)
        // what a stagger object gives each target (its own repeat / yoyo)
        if (per) ['repeat', 'yoyo', 'repeatDelay', 'yoyoEase'].forEach(function (key) { if (per[key] != null) c[key] = per[key] })
        var mine = window.gsap.to(t, c)
        parent.add(mine, Math.max(0, at + offs[i] / speed + (eff[ownerId(t)] || 0) * k))
        if (speed !== 1) mine.timeScale(speed)
        mine.__msShifted = true
        made.push({ t: t, tw: mine })
      })
    } finally {
      CAPTURE_OFF = wasOff
    }
    // the motion list keeps pointing at living tweens: the staggered motion at the first target's
    // copy, each target's own record (inside GSAP's stagger) at that target's copy
    MOTIONS.forEach(function (m) {
      var inner = m.nested && m.tween && m.tween.parent && m.tween.parent.parent === tw
      if (m.tween !== tw && !inner) return
      var target = inner ? m.tween.targets()[0] : null
      var hit = made.filter(function (x) { return inner ? x.t === target : ownerId(x.t) === m.owners[0] })[0] || (inner ? null : made[0])
      if (hit) { m.tween = hit.tw; m.split = true }
    })
  }
  function applyElementTiming(tl) {
    var tweens = tl.getChildren(true, true, false).filter(function (tw) { return !tw.__msShifted })
    tweens.forEach(function (tw) {
      tweenOwners(tw).forEach(function (id) { var o = EL[id]; if (o && o.animSpeed && o.animSpeed !== 1) tw.timeScale(o.animSpeed) })
    })
    var eff = {}
    Object.keys(EL).forEach(function (id) { if (layerShift(id)) eff[id] = layerShift(id) })
    if (!Object.keys(eff).length) return
    // moved earlier than the start of the video: the whole layer stops at 0 (its spacing is kept)
    // (a tween in a scene can only move back to the scene's start: that counts too)
    var first = {}
    tweens.forEach(function (tw) {
      if (initialSet(tw, tl)) return
      var k = 1
      for (var p = tw.parent; p && p !== tl; p = p.parent) k *= p.timeScale() || 1
      var s = Math.min(globalStart(tw, tl), tw.parent === tl ? Infinity : tw.startTime() / k)
      tweenOwners(tw).forEach(function (id) { if (eff[id] != null) first[id] = Math.min(first[id] == null ? Infinity : first[id], s) })
    })
    clipsOf(eff).forEach(function (c) { first[c.id] = Math.min(first[c.id] == null ? Infinity : first[c.id], c.start) })
    Object.keys(eff).forEach(function (id) { if (eff[id] < 0 && isFinite(first[id])) eff[id] = Math.max(eff[id], -first[id]) })
    tweens.forEach(function (tw) {
      if (initialSet(tw, tl)) return
      var moves = tweenOwners(tw).map(function (id) { return eff[id] || 0 })
      if (!moves.some(function (x) { return x })) return
      // a tween shared by layers moved together moves once
      if (moves.every(function (x) { return x === moves[0] })) moveTween(tw, tl, moves[0])
      else splitTween(tw, tl, eff)
    })
    // clips placed by data-start (videos, pictures) move with their layer
    clipsOf(eff).forEach(function (c) {
      c.el.setAttribute('data-start', Math.max(0, c.start + eff[c.id]).toFixed(4))
      c.el.setAttribute('data-ms-shifted', '')
    })
    LAYER_SHIFT = eff
  }
  /** elements with their own data-start inside moved layers (not sounds, not scenes) */
  function clipsOf(eff) {
    var out = []
    var list = document.querySelectorAll('[data-start]')
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      // the app already wrote a moved video's start into the page (the export reads it there)
      if (el.tagName === 'AUDIO' || el.hasAttribute('data-composition-id') || el.hasAttribute('data-ms-shifted') || el.hasAttribute('data-ms-shift-baked')) continue
      var id = ownerId(el)
      if (!id || eff[id] == null) continue
      out.push({ el: el, id: id, start: parseFloat(el.getAttribute('data-start')) || 0 })
    }
    return out
  }
  /** what each layer actually moved by (after the stop at 0), for the editor */
  var LAYER_SHIFT = {}
  /** motion times after the layers moved (the editor's blocks and Claude's keys show these) */
  function refreshMotionTimes(tl) {
    MOTIONS.forEach(function (m) {
      var tw = m.tween
      if (!tw || !inRoot(tw, tl)) return
      m.start = globalStart(tw, tl)
      m.end = m.start + tw.totalDuration() / (tw.timeScale() || 1)
      m.layerShift = LAYER_SHIFT[m.owners[0]] || 0
    })
  }

  // ---- 3a. the designer's keyframes and in/out points (output time) -----------------
  /** cubic-bezier(x1,y1,x2,y2) as an easing function */
  function bezierEase(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
    function sx(u) { return ((ax * u + bx) * u + cx) * u }
    function dx(u) { return (3 * ax * u + 2 * bx) * u + cx }
    return function (k) {
      if (k <= 0) return 0
      if (k >= 1) return 1
      var u = k
      for (var i = 0; i < 8; i++) {
        var err = sx(u) - k, d = dx(u)
        if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break
        u -= err / d
      }
      if (u < 0 || u > 1) {
        var lo = 0, hi = 1
        u = k
        for (var j = 0; j < 30; j++) { if (sx(u) < k) lo = u; else hi = u; u = (lo + hi) / 2 }
      }
      return ((ay * u + by) * u + cy) * u
    }
  }
  function easeOf(e) {
    var name = String(e || 'cubic-bezier(0.33,0,0.67,1)')
    if (name === 'linear') return 'none'
    var m = name.match(/^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/)
    if (m) return bezierEase(+m[1], +m[2], +m[3], +m[4])
    return name
  }
  /** an ease as a function (the frame hook evaluates keyframes itself) */
  function easeFnOf(e) {
    var x = easeOf(e)
    if (typeof x === 'function') return x
    if (x === 'none') return function (k) { return k }
    try { var f = window.gsap.parseEase(x); if (typeof f === 'function') return f } catch (err) { /* unknown ease */ }
    return bezierEase(0.33, 0, 0.67, 1)
  }
  function lerpCol(a, b, k) {
    function rgba(c) {
      var s = String(c).trim(), m = s.match(/^#([0-9a-f]{3,8})$/i)
      if (m) {
        var h = m[1]
        if (h.length < 6) h = h.split('').map(function (x) { return x + x }).join('')
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
      }
      m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i)
      return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null
    }
    var x = rgba(a), y = rgba(b)
    if (!x || !y) return k < 1 ? a : b
    var c = [0, 1, 2, 3].map(function (i) { return x[i] + (y[i] - x[i]) * k })
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + Math.round(c[3] * 1000) / 1000 + ')'
  }
  function validKeys(list) {
    return (list || []).filter(function (k) { return k && isFinite(k.t) && (typeof k.v === 'string' || isFinite(k.v)) })
      .map(function (k) { return { t: Math.max(0, +k.t), v: typeof k.v === 'string' ? k.v : +k.v, e: k.e } })
      .sort(function (a, b) { return a.t - b.t })
  }
  /** keyframes repeated after the last one until D: 'cycle' starts over, 'pingpong' goes back */
  function loopKeys(ks, mode, D) {
    if (!mode || ks.length < 2) return ks
    var first = ks[0].t, last = ks[ks.length - 1].t, period = last - first
    if (period < 1e-3) return ks
    var out = ks.slice()
    for (var n = 1; first + n * period < D && n < 400; n++) {
      var back = mode === 'pingpong' && n % 2 === 1
      for (var i = 0; i < ks.length; i++) {
        var j = back ? ks.length - 1 - i : i
        // going back, a segment eases like the one it mirrors
        var e = back ? (j > 0 ? ks[j - 1].e : ks[j].e) : ks[j].e
        out.push({ t: first + n * period + (back ? last - ks[j].t : ks[j].t - first), v: ks[j].v, e: e })
      }
    }
    return out
  }
  /** a keyframed value at output time t (the frame hook draws what CSS cannot tween) */
  function keyAt(list, t, loop) {
    var ks = validKeys(list)
    if (!ks.length) return undefined
    var first = ks[0].t, last = ks[ks.length - 1].t
    if (loop && t > last && last - first > 1e-6) {
      var period = last - first, n = Math.floor((t - first) / period), local = t - first - n * period
      t = loop === 'pingpong' && n % 2 === 1 ? last - local : first + local
    }
    if (t <= first) return ks[0].v
    for (var i = 0; i + 1 < ks.length; i++) {
      var a = ks[i], b = ks[i + 1]
      if (t < b.t) {
        if (a.e === 'hold') return a.v
        var k = easeFnOf(a.e)((t - a.t) / Math.max(1e-6, b.t - a.t))
        if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * k
        return lerpCol(a.v, b.v, k)
      }
    }
    return ks[ks.length - 1].v
  }
  /**
   * Tweens of one property between its keyframes on the output timeline: the value holds before
   * the first key and after the last; `unit` turns numbers into CSS ('' keeps them as they are,
   * for GSAP properties such as y or --mouth-open).
   */
  function addKeyTweens(T, D, targets, prop, unit, list, loop) {
    var ks = loopKeys(validKeys(list), loop, D).filter(function (k) { return k.t <= D + 1e-6 })
    if (!ks.length || !targets.length) return
    var val = function (v) { return typeof v === 'number' ? (unit ? v + unit : v) : col(v) }
    var first = {}
    first[prop] = val(ks[0].v)
    T.set(targets, first, 0)
    for (var i = 0; i + 1 < ks.length; i++) {
      var a = ks[i], b = ks[i + 1]
      var to = {}
      to[prop] = val(b.v)
      if (a.e === 'hold' || b.t - a.t < 1e-4) { T.set(targets, to, b.t); continue }
      var from = {}
      from[prop] = val(a.v)
      to.duration = b.t - a.t
      to.ease = easeOf(a.e)
      to.immediateRender = false
      T.fromTo(targets, from, to, a.t)
    }
  }
  /** x and y keyed at the same times with path handles: the position moves along curves */
  function spatialKeys(o) {
    var xs = validKeys(o.keys && o.keys.x), ys = validKeys(o.keys && o.keys.y)
    if (xs.length < 2 || xs.length !== ys.length) return null
    for (var i = 0; i < xs.length; i++) if (Math.abs(xs[i].t - ys[i].t) > 1e-3) return null
    var raw = (o.keys.x || []).slice().sort(function (a, b) { return a.t - b.t })
    if (!raw.some(function (k) { return k && k.c })) return null
    return { xs: xs, ys: ys, c: raw.map(function (k) { return k.c || null }) }
  }
  /** a curved path: one tween per segment drives both position variables along the cubic curve */
  function addPathTweens(T, targets, sp) {
    var xs = sp.xs, ys = sp.ys, c = sp.c
    var set = function (x, y) { for (var i = 0; i < targets.length; i++) { targets[i].style.setProperty('--ms-x', x + 'px'); targets[i].style.setProperty('--ms-y', y + 'px') } }
    T.set(targets, { '--ms-x': xs[0].v + 'px', '--ms-y': ys[0].v + 'px' }, 0)
    for (var i = 0; i + 1 < xs.length; i++) {
      (function (i) {
        var a = { x: +xs[i].v, y: +ys[i].v }, d = { x: +xs[i + 1].v, y: +ys[i + 1].v }
        var ca = c[i] || {}, cd = c[i + 1] || {}
        var b = { x: a.x + num(ca.ox, 0), y: a.y + num(ca.oy, 0) }, e = { x: d.x + num(cd.ix, 0), y: d.y + num(cd.iy, 0) }
        if (xs[i].e === 'hold' || xs[i + 1].t - xs[i].t < 1e-4) { T.set(targets, { '--ms-x': d.x + 'px', '--ms-y': d.y + 'px' }, xs[i + 1].t); return }
        var proxy = { k: 0 }
        T.fromTo(proxy, { k: 0 }, {
          k: 1, duration: xs[i + 1].t - xs[i].t, ease: easeOf(xs[i].e), immediateRender: false,
          onUpdate: function () {
            var k = proxy.k, u = 1 - k, A = u * u * u, B = 3 * u * u * k, C = 3 * u * k * k, D = k * k * k
            set(A * a.x + B * b.x + C * e.x + D * d.x, A * a.y + B * b.y + C * e.y + D * d.y)
          },
        }, xs[i].t)
      })(i)
    }
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  var WIGGLE = { x: ['--ms-wx', 'px'], y: ['--ms-wy', 'px'], rotate: ['--ms-wr', 'deg'], scale: ['--ms-ws', ''], opacity: ['--ms-wo', ''] }
  /** wiggle: random values freq times a second, eased between (the same every render: seeded by the layer) */
  function addWiggle(T, D, targets, id, p, w) {
    var spec = WIGGLE[p], freq = Math.max(0.1, Math.min(30, num(w.freq, 2))), amount = num(w.amount, 0)
    if (!spec || !amount || !targets.length) return
    if (p === 'scale') amount = amount / 100
    var r = rng(hashStr(id + ':' + p)), step = 1 / freq, prev = 0
    var at0 = {}
    at0[spec[0]] = '0' + spec[1]
    T.set(targets, at0, 0)
    for (var i = 1; (i - 1) * step < D; i++) {
      var v = p === 'opacity' ? r() * Math.min(1, Math.abs(amount)) : (r() * 2 - 1) * amount
      var a = {}, b = {}
      a[spec[0]] = prev + spec[1]
      b[spec[0]] = v + spec[1]
      b.duration = step
      b.ease = 'sine.inOut'
      b.immediateRender = false
      T.fromTo(targets, a, b, (i - 1) * step)
      prev = v
    }
  }
  /** the elements a property of a layer lives on: its wrapper(s), the element itself, or <body> for the camera */
  function targetsOf(id, where) {
    if (id === CAMERA) return document.body ? [document.body] : []
    var sel = where === 'el' ? '[data-ms-id="' + esc(id) + '"]' : '[data-ms-wrap-for="' + esc(id) + '"]'
    return Array.prototype.slice.call(document.querySelectorAll(sel))
  }

  // ---- 3c. the frame hook: what CSS cannot tween is drawn after every render of the output timeline ----
  var HOOKS = []
  function installFrameHook(T) {
    if (!HOOKS.length) return
    var prev = T.eventCallback('onUpdate')
    T.eventCallback('onUpdate', function () {
      if (prev) prev.apply(this, arguments)
      runHooks(T.time())
    })
    runHooks(0)
  }
  function runHooks(t) {
    for (var i = 0; i < HOOKS.length; i++) { try { HOOKS[i](t) } catch (e) { /* a hook never stops the video */ } }
  }
  function fmtNumber(v, decimals, comma) {
    var d = Math.max(0, Math.min(6, decimals | 0))
    var s = (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d)
    if (!comma) return s
    var parts = s.split('.'), neg = parts[0].charAt(0) === '-', int = neg ? parts[0].slice(1) : parts[0]
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return (neg ? '-' : '') + int + (parts[1] ? '.' + parts[1] : '')
  }
  /** a number counting up (prices, percentages) */
  function counterHook(id, c) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
    if (!el) return
    var ease = easeFnOf(c.ease || 'power2.out'), last = null
    HOOKS.push(function (t) {
      var k = t <= c.start ? 0 : t >= c.start + c.duration ? 1 : ease((t - c.start) / Math.max(1e-3, c.duration))
      var v = num(c.from, 0) + (num(c.to, 0) - num(c.from, 0)) * k
      var text = (c.prefix || '') + fmtNumber(v, c.decimals, c.comma) + (c.suffix || '')
      if (text !== last) { el.textContent = text; last = text }
    })
  }
  /** the text changes at set times (After Effects' Source Text keyframes): each holds until the next */
  function textKeysHook(id, list) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
    if (!el) return
    var keys = list.filter(function (k) { return k && isFinite(k.t) }).slice().sort(function (a, b) { return a.t - b.t })
    var original = el.innerHTML, last = null
    HOOKS.push(function (t) {
      var k = null
      for (var i = 0; i < keys.length; i++) if (keys[i].t <= t + 1e-6) k = keys[i]
      var html = k ? String(k.text).split('\n').map(function (l) { return l.replace(/&/g, '&amp;').replace(/</g, '&lt;') }).join('<br>') : original
      if (html !== last) { el.innerHTML = html; last = html }
    })
  }
  /** a keyframed mask is redrawn at every frame */
  function maskHook(id, o) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
    var g = GEO[id]
    if (!el || !g) return
    var target = MASK_WRAP[id] ? wrapperOf(el) : el, last = null
    if (!target) return
    HOOKS.push(function (t) {
      var css = maskCss(maskAt(o, t), g, !MASK_WRAP[id])
      if (css === last) return
      last = css
      css.split(';').forEach(function (d) {
        var i = d.indexOf(':'), name = d.slice(0, i), value = d.slice(i + 1).replace(/\s*!important$/, '')
        target.style.setProperty(name, value, 'important')
      })
    })
  }

  function mulA(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]] }
  function invA(M) {
    var det = M[0] * M[3] - M[1] * M[2] || 1e-9
    return [M[3] / det, -M[1] / det, -M[2] / det, M[0] / det, (M[2] * M[5] - M[3] * M[4]) / det, (M[1] * M[4] - M[0] * M[5]) / det]
  }
  function cssMatrix(M) { return 'matrix(' + M.map(function (v) { return Math.round(v * 100000) / 100000 }).join(',') + ')' }
  /** time the hooks are installed at: the main output timeline may be read at another time and put back */
  function atTime(t, f) {
    if (!MAIN_OUT) return f()
    var keep = MAIN_OUT.totalTime()
    MAIN_OUT.totalTime(t, true)
    try { return f() } finally { MAIN_OUT.totalTime(keep, true) }
  }
  /**
   * A layer linked to a parent (After Effects' parenting) follows how the parent moved, turned
   * and scaled since the moment of the link — Claude's motion of the parent included.
   */
  function parentHook(id, par) {
    var w = targetsOf(id, 'wrap')[0], pel = PARTS[par.id] ? PARTS[par.id].el : document.querySelector('[data-ms-id="' + esc(par.id) + '"]')
    if (!w || !pel || pel.contains(w) || w.contains(pel)) return
    var rb = rootOrigin()
    var Mat = atTime(+par.at || 0, function () { return matrixOf(pel, rb) })
    var inv0 = invA(Mat), last = null
    HOOKS.push(function () {
      var D = mulA(matrixOf(pel, rb), inv0)
      var Mwp = matrixOf(w.parentElement, rb)
      var Dl = mulA(invA(Mwp), mulA(D, Mwp))
      var cs = getComputedStyle(w)
      var ox = cssNum(cs, '--ms-cx') + cssNum(cs, '--ms-ax'), oy = cssNum(cs, '--ms-cy') + cssNum(cs, '--ms-ay')
      var X = mulA([1, 0, 0, 1, -ox, -oy], mulA(Dl, [1, 0, 0, 1, ox, oy]))
      var m = cssMatrix(X)
      if (m !== last) { w.style.setProperty('--ms-pm', m); last = m }
    })
  }
  /** a mask on the wrapper (the element masks itself already) follows the element's own motion */
  function maskFollowHook(id, o) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]'), w = el && wrapperOf(el), g = GEO[id]
    if (!el || !w || !g) return
    var rb = rootOrigin(), last = null
    HOOKS.push(function (t) {
      var rel = mulA(invA(matrixOf(w, rb)), matrixOf(el, rb))
      var m = maskAt(o, t)
      var xs = [], ys = []
      ;[[m.x, m.y], [m.x + m.w, m.y], [m.x, m.y + m.h], [m.x + m.w, m.y + m.h]].forEach(function (p) {
        xs.push(rel[0] * p[0] + rel[2] * p[1] + rel[4]); ys.push(rel[1] * p[0] + rel[3] * p[1] + rel[5])
      })
      var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys)
      var moved = Object.assign({}, m, { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 })
      var css = maskCss(moved, { l: 0, t: 0, pw: g.pw, ph: g.ph }, false)
      if (css === last) return
      last = css
      css.split(';').forEach(function (d) { var i = d.indexOf(':'); w.style.setProperty(d.slice(0, i), d.slice(i + 1)) })
    })
  }
  /**
   * A track matte (After Effects): an image layer shapes this one (its alpha or its brightness,
   * or the opposite), wherever the image moves; the image itself is hidden.
   */
  function matteHook(id, mt) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]'), me = document.querySelector('[data-ms-id="' + esc(mt.layer) + '"]')
    var img = me && (/^IMG$/.test(me.tagName) ? me : me.querySelector('img'))
    if (!el || !img) return
    var rb = rootOrigin(), last = null
    HOOKS.push(function () {
      var rel = mulA(invA(matrixOf(el, rb)), matrixOf(img, rb))
      var w = img.offsetWidth || 1, h = img.offsetHeight || 1, xs = [], ys = []
      ;[[0, 0], [w, 0], [0, h], [w, h]].forEach(function (p) { xs.push(rel[0] * p[0] + rel[2] * p[1] + rel[4]); ys.push(rel[1] * p[0] + rel[3] * p[1] + rel[5]) })
      var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), x1 = Math.max.apply(null, xs), y1 = Math.max.apply(null, ys)
      var url = 'url("' + String(img.currentSrc || img.src).replace(/"/g, '%22') + '")'
      var luma = mt.mode === 'luma' || mt.mode === 'lumaInv', inv = mt.mode === 'alphaInv' || mt.mode === 'lumaInv'
      var d = [
        ['mask-image', inv ? url + ', linear-gradient(#000,#000)' : url],
        ['mask-mode', luma ? (inv ? 'luminance, alpha' : 'luminance') : 'alpha'],
        ['mask-size', (x1 - x0) + 'px ' + (y1 - y0) + 'px' + (inv ? ', 100% 100%' : '')],
        ['mask-position', x0 + 'px ' + y0 + 'px' + (inv ? ', 0 0' : '')],
        ['mask-repeat', 'no-repeat'],
        ['mask-composite', inv ? 'exclude' : 'add'],
      ]
      var key = d.map(function (x) { return x[1] }).join('|')
      if (key === last) return
      last = key
      d.forEach(function (x) { el.style.setProperty(x[0], x[1], 'important') })
    })
  }
  /** motion blur from the designer's keyframed movement: a blur along x and y, as long as the frame's travel */
  var BLUR_SVG = null
  function motionBlurHook(id, o) {
    var w = targetsOf(id, 'wrap')[0]
    if (!w) return
    if (!BLUR_SVG) {
      BLUR_SVG = document.createElementNS(SVGNS, 'svg')
      BLUR_SVG.setAttribute('width', '0')
      BLUR_SVG.setAttribute('height', '0')
      BLUR_SVG.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
      BLUR_SVG.appendChild(document.createElementNS(SVGNS, 'defs'))
      document.body.appendChild(BLUR_SVG)
    }
    var f = document.createElementNS(SVGNS, 'filter')
    f.setAttribute('id', blurId(id))
    f.setAttribute('x', '-50%'); f.setAttribute('y', '-50%'); f.setAttribute('width', '200%'); f.setAttribute('height', '200%')
    var gb = document.createElementNS(SVGNS, 'feGaussianBlur')
    gb.setAttribute('stdDeviation', '0 0')
    f.appendChild(gb)
    BLUR_SVG.firstChild.appendChild(f)
    var root = mainRoot(), fps = num(root && root.getAttribute('data-fps'), 30) || 30
    var shutter = Math.max(0, num(o.motionBlur, 0.5)), h = 1 / fps / 2, last = null
    var pos = function (t) {
      var x = 0, y = 0
      if (keyed(o, 'x')) x += num(keyAt(o.keys.x, t, o.loops && o.loops.x), 0)
      if (keyed(o, 'y')) y += num(keyAt(o.keys.y, t, o.loops && o.loops.y), 0)
      if (o.own && o.own.x) x += num(keyAt(o.own.x, t), 0)
      if (o.own && o.own.y) y += num(keyAt(o.own.y, t), 0)
      return [x, y]
    }
    HOOKS.push(function (t) {
      var a = pos(t - h), b = pos(t + h)
      // travel during the shutter (a share of one frame), as a gaussian's width
      var sx = Math.abs(b[0] - a[0]) * shutter / 2, sy = Math.abs(b[1] - a[1]) * shutter / 2
      var v = (Math.round(sx * 10) / 10) + ' ' + (Math.round(sy * 10) / 10)
      if (v !== last) { gb.setAttribute('stdDeviation', v); last = v }
    })
  }
  function addDesignerTweens(T, D) {
    var gs = window.gsap
    if (!gs) return
    CAPTURE_OFF = true
    try {
      addTextAnims(T)
      Object.keys(EL).forEach(function (id) {
        var o = EL[id] || {}
        var hasWrap = id === CAMERA || !!document.querySelector('[data-ms-wrap-for="' + esc(id) + '"]')
        var sp = hasWrap ? spatialKeys(o) : null
        if (sp) addPathTweens(T, targetsOf(id, 'wrap'), sp)
        Object.keys(o.keys || {}).forEach(function (p) {
          var kv = KEYVAR[p]
          if (!kv) return
          if (kv.target === 'wrap' && !hasWrap) return
          if (sp && (p === 'x' || p === 'y')) return
          addKeyTweens(T, D, targetsOf(id, kv.target), kv.v, kv.unit, o.keys[p], o.loops && o.loops[p])
        })
        Object.keys(o.wiggle || {}).forEach(function (p) { if (hasWrap) addWiggle(T, D, targetsOf(id, 'wrap'), id, p, o.wiggle[p]) })
        // properties taken over from Claude's code: absolute keyframes on the element itself
        Object.keys(o.own || {}).forEach(function (p) { addKeyTweens(T, D, targetsOf(id, 'el'), p, '', o.own[p], o.loops && o.loops['own:' + p]) })
        if (o.parent && o.parent.id) parentHook(id, o.parent)
        if (o.mask && MASK_WRAP[id]) maskFollowHook(id, o)
        if (o.matte && o.matte.layer) matteHook(id, o.matte)
        if (num(o.motionBlur, 0) > 0) motionBlurHook(id, o)
        if (o.counter) counterHook(id, o.counter)
        else if (o.textKeys && o.textKeys.length) textKeysHook(id, o.textKeys)
        if (maskKeyed(o) && !MASK_WRAP[id]) maskHook(id, o)
        // in / out points: the layer shows only between them
        var w = targetsOf(id, 'wrap')
        var inP = o.inPoint != null ? Math.max(0, +o.inPoint) : 0
        var outP = o.outPoint != null ? Math.min(D, +o.outPoint) : D
        if (w.length && (inP > 0 || outP < D)) {
          T.set(w, { '--ms-io': inP > 0 ? 0 : 1 }, 0)
          if (inP > 0) T.set(w, { '--ms-io': 1 }, inP)
          if (outP < D) T.set(w, { '--ms-io': 0 }, Math.max(inP, outP))
        } else if (!w.length && id !== CAMERA && (inP > 0 || outP < D)) {
          // a layer the composition lays out has no wrapper: it is hidden by an attribute the
          // stylesheet answers with !important (Claude's own opacity / autoAlpha stay as they are)
          var self = targetsOf(id, 'el')
          T.set(self, { attr: { 'data-ms-io': inP > 0 ? '0' : '1' } }, 0)
          if (inP > 0) T.set(self, { attr: { 'data-ms-io': '1' } }, inP)
          if (outP < D) T.set(self, { attr: { 'data-ms-io': '0' } }, Math.max(inP, outP))
        }
      })
    } finally {
      CAPTURE_OFF = false
    }
    installFrameHook(T)
  }

  // piecewise-linear map from authored time -> output time
  function makeMap(D) {
    var segs = [], cur = 0
    REMAP.forEach(function (s) {
      var a = Math.max(cur, Math.min(s.from, D)), b = Math.min(s.to, D)
      if (a > cur) segs.push({ a: cur, b: a, k: 1 })
      if (b > a) segs.push({ a: a, b: b, k: s.speed })
      cur = Math.max(cur, b)
    })
    if (cur < D) segs.push({ a: cur, b: D, k: 1 })
    var out = 0
    segs.forEach(function (s) { s.o = out; out += (s.b - s.a) / s.k })
    return { segs: segs, length: out, map: function (t) {
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i]
        if (t <= s.b) return s.o + (Math.max(t, s.a) - s.a) / s.k
      }
      return out
    } }
  }

  function remapClips(root, M, D, finalLen) {
    var nodes = (root || document).querySelectorAll('[data-start]')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      if (el.hasAttribute('data-composition-id')) continue
      // the app already wrote the remapped timing into the file (the renderer reads it from there)
      if (el.hasAttribute('data-ms-authored-start')) continue
      // music keeps real time; sound effects and narration stay locked to the picture they accompany
      var at = el.getAttribute('data-ms-type')
      if (el.tagName === 'AUDIO' && at !== 'sfx' && at !== 'voice') continue
      // the designer's own clips are placed in output time
      if (el.hasAttribute('data-ms-designer')) continue
      var s = parseFloat(el.getAttribute('data-start')) || 0
      var d = parseFloat(el.getAttribute('data-duration'))
      var ns = M.map(s)
      if (el.tagName === 'VIDEO' && isFinite(d)) {
        // footage inside a single sped-up section plays faster too; a clip
        // straddling a section boundary is flagged for the editor to warn about
        var seg = M.segs.filter(function (g) { return s >= g.a - 1e-6 && s + d <= g.b + 1e-6 })[0]
        if (seg && seg.k !== 1) {
          var r = parseFloat(el.getAttribute('data-playback-rate')) || 1
          el.setAttribute('data-playback-rate', String(r * seg.k))
        } else if (!seg && M.segs.some(function (g) { return g.k !== 1 && g.a < s + d && g.b > s })) {
          el.setAttribute('data-ms-remap-partial', 'true')
        }
      }
      el.setAttribute('data-start', ns.toFixed(4))
      if (isFinite(d)) {
        var end = s + d >= D - 1e-3 ? finalLen : M.map(s + d)
        el.setAttribute('data-duration', Math.max(0, end - ns).toFixed(4))
      }
    }
  }

  // ---- 3b. when each editable element is on screen (for the editor's timeline bars) ----
  var TIMING = {}
  function globalStart(tw, root) {
    var t = tw.startTime()
    for (var p = tw.parent; p && p !== root; p = p.parent) t = p.startTime() + t / (p.timeScale() || 1)
    return t
  }
  function collectTiming(tl) {
    var sets = {}
    tl.getChildren(true, true, false).forEach(function (tw) {
      var s = globalStart(tw, tl)
      var len = tw.totalDuration() / (tw.timeScale() || 1)
      // a staggered tween's duration spans every target: one target plays for what is left after the last offset
      var offs = staggerOffsets(tw), maxOff = offs ? Math.max.apply(null, offs) : 0
      var init = initialSet(tw, tl)
      tw.targets().forEach(function (t, i) {
        var id = ownerId(t)
        if (!id) return
        // an initial state at 0 (autoAlpha:0 before an entrance) is not when the layer shows up
        if (init) { sets[id] = 1; return }
        var ts = tw.timeScale() || 1
        var a = s + (offs ? offs[i] / ts : 0)
        var r = TIMING[id] || (TIMING[id] = { start: Infinity, end: -Infinity })
        r.start = Math.min(r.start, a)
        // each target ends that much before the last one (repeats included)
        r.end = Math.max(r.end, offs ? s + len - (maxOff - offs[i]) / ts : s + len)
      })
    })
    Object.keys(sets).forEach(function (id) { if (!TIMING[id]) TIMING[id] = { start: 0, end: 0 } })
    var clips = document.querySelectorAll('[data-ms-id][data-start]')
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i], id = c.getAttribute('data-ms-id')
      var cs = parseFloat(c.getAttribute('data-start')) || 0
      var cd = parseFloat(c.getAttribute('data-duration'))
      var r = TIMING[id] || (TIMING[id] = { start: Infinity, end: -Infinity })
      r.start = Math.min(r.start, cs)
      if (isFinite(cd)) r.end = Math.max(r.end, cs + cd)
    }
  }

  var MAIN_DURATION = 0
  /** the timeline the player drives (output time): the authored one, or the speed-change wrapper */
  var MAIN_OUT = null
  function wrapTimeline(id, tl) {
    if (!tl || typeof tl.getChildren !== 'function' || tl.__msWrapped) return tl
    var rootEl = document.querySelector('[data-composition-id="' + esc(id) + '"]')
    var root = mainRoot()
    var isMain = !prepped && (!root || rootEl === root || !rootEl)
    if (isMain) { try { prep(tl) } catch (e) { /* duplicates and order are best effort */ } }
    try { finishMotions(tl, isMain) } catch (e) { /* motion edits are best effort */ }
    try { applyElementTiming(tl) } catch (e) { /* layer timing is best effort */ }
    try { refreshMotionTimes(tl) } catch (e) { /* the editor's motion times are best effort */ }
    try { collectTiming(tl) } catch (e) { /* timing bars are best effort */ }
    wrapEditables()
    // registered twice: designer edits must not be applied twice
    tl.__msWrapped = true
    // when section speed changes the length, the app writes the output length into
    // data-duration (the renderer reads it statically) and keeps the authored one aside
    var D = rootEl ? parseFloat(rootEl.getAttribute('data-ms-authored-duration') || rootEl.getAttribute('data-duration')) || tl.duration() : tl.duration()
    if (!REMAP.length) {
      if (isMain) {
        MAIN_OUT = tl
        MAIN_DURATION = D
        try { addDesignerTweens(tl, D) } catch (e) { /* keyframes are best effort */ }
      }
      return tl
    }
    var M = makeMap(D)
    var finalLen = KEEP_TOTAL ? Math.max(D, M.length) : M.length
    var W = gsap.timeline({ paused: true })
    M.segs.forEach(function (s) {
      W.add(tl.tweenFromTo(s.a, s.b, { duration: (s.b - s.a) / s.k, ease: 'none', immediateRender: false }), s.o)
    })
    if (finalLen > M.length) W.add(tl.tweenFromTo(D, D, { duration: finalLen - M.length, ease: 'none', immediateRender: false }), M.length)
    remapClips(rootEl, M, D, finalLen)
    if (rootEl) rootEl.setAttribute('data-duration', finalLen.toFixed(4))
    if (isMain) {
      MAIN_OUT = W
      MAIN_DURATION = finalLen
      try { addDesignerTweens(W, finalLen) } catch (e) { /* keyframes are best effort */ }
    }
    W.__msWrapped = true
    W.__msInner = tl
    window.__MS_TIME_MAP__ = M
    return W
  }

  var store = {}
  window.__timelines = new Proxy(store, {
    set: function (obj, key, value) { obj[key] = wrapTimeline(String(key), value); return true },
  })
  document.addEventListener('DOMContentLoaded', wrapEditables)
  /** plain boxes are only told apart once the page is read: named and wrapped then */
  document.addEventListener('DOMContentLoaded', function () {
    if (!wrapped) return
    try {
      if (autoIds()) scan(document.body)
      // named now (here, or by the designer's own edits a moment ago) but not wrapped yet
      var fresh = 0
      document.querySelectorAll('[data-ms-auto]').forEach(function (e) {
        if (e.hasAttribute('data-ms-unwrappable') || (e.parentElement && e.parentElement.hasAttribute('data-ms-wrap-for'))) return
        wrapOne(e)
        fresh++
      })
      if (fresh) applyStyles(EL)
    } catch (e) { /* layers of their own are best effort */ }
  })

  // ---- 3d. Claude's motion as keyframes (for the designer to take over) ----------------
  var READ_AS = { scale: 'scaleX', autoAlpha: 'opacity', rotate: 'rotation' }
  /** a property of an element as GSAP sees it now: a number, or a colour / other string */
  function readProp(el, p) {
    var v = window.gsap.getProperty(el, READ_AS[p] || p)
    if (typeof v === 'string') {
      var n = v.trim()
      if (/^-?\d*\.?\d+(e-?\d+)?$/.test(n)) return Math.round(parseFloat(n) * 10000) / 10000
      return n
    }
    return typeof v === 'number' && isFinite(v) ? Math.round(v * 10000) / 10000 : v
  }
  /** GSAP's default ease and eases it cannot name become the editor's easy ease */
  function keyEase(e) { return !e ? 'power1.out' : e === 'custom' ? 'cubic-bezier(0.33,0,0.67,1)' : e }
  /**
   * Every property Claude's code animates on a layer itself, as keyframes: the values are read
   * from the playing timeline at the start and end of each tween (and each repeat), so random,
   * relative or computed values come out as the numbers they really are.
   */
  function claudeTracks(id, only) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
    if (!el || !MAIN_OUT || !window.gsap) return {}
    var MM = window.__MS_TIME_MAP__
    var out = (function (t) { return MM ? MM.map(t) : t })
    var segs = {}
    MOTIONS.forEach(function (m) {
      if (m.self !== id || m.start == null || m.end == null || m.disabled) return
      m.props.forEach(function (p) {
        if (p.owned || (only && only.indexOf(p.name) < 0)) return
        var a = out(m.start), b = out(m.end)
        var times = [a, b]
        // repeats and keyframes: every cycle / every 0.1 s so the shape survives
        if (m.repeat > 0 && m.repeat < 50) { var cyc = (m.end - m.start) / (m.repeat + 1); for (var r = 1; r <= m.repeat; r++) times.push(out(m.start + cyc * r)) }
        if (m.type === 'keyframes') for (var q = m.start + 0.1; q < m.end - 0.05; q += 0.1) times.push(out(q))
        ;(segs[p.name] = segs[p.name] || []).push({ a: a, b: b, ease: m.type === 'keyframes' ? 'linear' : keyEase(m.ease), times: times })
      })
    })
    var P = window.__player, keep = P ? P.getTime() : MAIN_OUT.time(), res = {}
    try {
      Object.keys(segs).forEach(function (p) {
        var list = segs[p].sort(function (x, y) { return x.a - y.a }), seen = {}, times = [0]
        list.forEach(function (sg) { sg.times.forEach(function (t) { times.push(t) }) })
        times = times.map(function (t) { return Math.round(t * 10000) / 10000 }).filter(function (t) { if (seen[t]) return false; seen[t] = 1; return true })
          .sort(function (x, y) { return x - y })
        res[p] = times.map(function (t) {
          MAIN_OUT.totalTime(t, true)
          var start = list.filter(function (sg) { return Math.abs(sg.a - t) < 1e-3 })[0]
          var inside = list.filter(function (sg) { return sg.a < t - 1e-3 && sg.b > t + 1e-3 })[0]
          return { t: t, v: readProp(el, p), e: start ? start.ease : inside ? inside.ease : 'linear' }
        })
      })
    } finally {
      if (P) P.seek(keep)
      else MAIN_OUT.totalTime(keep, true)
    }
    return res
  }
  /** properties of a layer as they are at this moment (the inspector's numbers) */
  function propsNow(id, props) {
    var el = document.querySelector('[data-ms-id="' + esc(id) + '"]'), res = {}
    if (!el || !window.gsap) return res
    props.forEach(function (p) { try { res[p] = readProp(el, p) } catch (e) { /* unknown property */ } })
    return res
  }

  // ---- 4. editor bridge -------------------------------------------------------
  function compRoot() { return document.querySelector('[data-composition-id]') || document.body }
  function wrapperOf(el) { var p = el.parentElement; return p && p.getAttribute('data-ms-wrap-for') === el.getAttribute('data-ms-id') ? p : null }
  function cssNum(cs, name) { return parseFloat(cs.getPropertyValue(name)) || 0 }
  function stackKeyOf(el) {
    var host = wrapperOf(el) || el
    var p = host.parentElement
    return p ? p.getAttribute('data-ms-stack') || '' : ''
  }
  /** position among the siblings that share a parent, top of the stack first (one pass per parent) */
  var RANKS = null
  function stackRank(el) {
    var host = wrapperOf(el) || el
    var p = host.parentElement
    if (!p) return 0
    if (RANKS && RANKS.has(el)) return RANKS.get(el)
    var sibs = []
    for (var i = 0; i < p.children.length; i++) {
      var c = p.children[i]
      var e = c.hasAttribute('data-ms-wrap-for') ? c.firstElementChild : c
      if (!e || !e.hasAttribute || !e.hasAttribute('data-ms-id')) continue
      var z = getComputedStyle(c).zIndex
      sibs.push({ el: e, z: z === 'auto' ? 0 : +z || 0, i: i })
    }
    sibs.sort(function (a, b) { return b.z - a.z || b.i - a.i })
    var rank = 0
    for (var k = 0; k < sibs.length; k++) {
      if (RANKS) RANKS.set(sibs[k].el, k)
      if (sibs[k].el === el) rank = k
    }
    return rank
  }
  // ---- an element's own coordinates on the canvas ----
  // A 2D affine map [a, b, c, d, e, f] (CSS matrix order) from an element's own px (its top-left
  // = 0,0, before any transform) to composition px, now: the turn / scale of every ancestor up to
  // the root multiplied together, then placed so its box lands on the measured box. Masks are
  // drawn and shown through it. 3D turns are left out (approximate).
  function mul2(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3]] }
  function angleOf(s) {
    var n = parseFloat(s)
    return /rad$/.test(s) ? n : /grad$/.test(s) ? n * Math.PI / 200 : /turn$/.test(s) ? n * 2 * Math.PI : n * Math.PI / 180
  }
  /** the linear part of an element's own transform (translate, then rotate, scale, transform) */
  function linearOf(n) {
    var cs = getComputedStyle(n), L = [1, 0, 0, 1]
    var r = cs.rotate
    if (r && r !== 'none') {
      var parts = r.trim().split(/\s+/)
      if (parts.length === 1 || /^0 0 1 /.test(r)) {
        var a = angleOf(parts[parts.length - 1])
        L = mul2(L, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)])
      }
    }
    var sc = cs.scale
    if (sc && sc !== 'none') {
      var sv = sc.trim().split(/\s+/).map(parseFloat)
      L = mul2(L, [sv[0], 0, 0, sv.length > 1 ? sv[1] : sv[0]])
    }
    var t = cs.transform
    if (t && t !== 'none') {
      var v = t.slice(t.indexOf('(') + 1, -1).split(',').map(parseFloat)
      L = mul2(L, t.indexOf('matrix3d') === 0 ? [v[0], v[1], v[4], v[5]] : [v[0], v[1], v[2], v[3]])
    }
    return L
  }
  function matrixOf(n, rootBox) {
    // a part of a drawing: SVG knows its own map to the screen
    if (n.namespaceURI === SVGNS && n.localName !== 'svg' && n.getScreenCTM) {
      var m = n.getScreenCTM()
      if (m) return [m.a, m.b, m.c, m.d, m.e - rootBox.left, m.f - rootBox.top]
    }
    var L = [1, 0, 0, 1]
    // up to <html>: the camera turns and scales <body>
    for (var p = n; p && p.nodeType === 1 && p !== document.documentElement; p = p.parentElement) L = mul2(linearOf(p), L)
    var w = n.offsetWidth || 0, h = n.offsetHeight || 0
    var xs = [0, L[0] * w, L[2] * h, L[0] * w + L[2] * h], ys = [0, L[1] * w, L[3] * h, L[1] * w + L[3] * h]
    var r = n.getBoundingClientRect()
    return [L[0], L[1], L[2], L[3], r.left - rootBox.left - Math.min.apply(null, xs), r.top - rootBox.top - Math.min.apply(null, ys)]
  }
  /** where the layer's mask is drawn: the element's own coordinates (through its wrapper when the mask sits there) */
  function maskSpace(el, w, g, rootBox) {
    if (!MASK_WRAP[el.getAttribute('data-ms-id')]) return matrixOf(el, rootBox)
    var M = matrixOf(w, rootBox)
    return [M[0], M[1], M[2], M[3], M[0] * g.l + M[2] * g.t + M[4], M[1] * g.l + M[3] * g.t + M[5]]
  }
  /**
   * Composition px are measured from where the root is laid out: with the camera moving <body>
   * the boxes are where they show in the frame.
   */
  function rootOrigin() {
    var root = compRoot()
    if (document.body && getComputedStyle(document.body).transform !== 'none') return { left: root.offsetLeft, top: root.offsetTop }
    return root.getBoundingClientRect()
  }
  /** a character's acting parameters (SvgRig) when the layer is one */
  function rigOf(el) {
    var R = window.SvgRig
    if (!R || typeof R.chars !== 'function') return null
    var c = R.chars().filter(function (x) { return x.host === el })[0]
    if (!c) return null
    return Object.keys(c.defs).map(function (k) { return { name: k, def: +c.defs[k] || 0 } })
  }
  function depthOf(el) {
    var depth = 0
    for (var a = el.parentElement && el.parentElement.closest('[data-ms-id]'); a; a = a.parentElement && a.parentElement.closest('[data-ms-id]')) depth++
    return depth
  }
  /** a character part as a layer: its box, its pivot (composition px) and how many px one drawing unit is */
  function describePart(pid, rootBox, index) {
    var P = PARTS[pid], g = P.el, w = P.wrap
    var r = g.getBoundingClientRect()
    var hostEl = document.querySelector('[data-ms-id="' + esc(P.host) + '"]')
    var wcs = getComputedStyle(w)
    var ctm = w.parentNode && w.parentNode.getScreenCTM ? w.parentNode.getScreenCTM() : null
    var pivot = null, unit = 1
    if (ctm) {
      var pt = new DOMPoint(P.pivot[0] + cssNum(wcs, '--ms-x'), P.pivot[1] + cssNum(wcs, '--ms-y')).matrixTransform(ctm)
      pivot = { x: pt.x - rootBox.left, y: pt.y - rootBox.top }
      unit = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1
    }
    var o = EL[pid] || {}
    return {
      id: pid, label: o.label || P.label, type: 'part', tag: 'g', designer: null, copyOf: null,
      parent: P.host, depth: hostEl ? depthOf(hostEl) + 1 : 1, stack: 'part:' + P.host, rank: index,
      movable: true, transformable: true, visible: r.width > 0 && r.height > 0 && parseFloat(wcs.opacity) > 0.01,
      rect: { x: r.left - rootBox.left, y: r.top - rootBox.top, w: r.width, h: r.height },
      base: null, pivot: pivot, unit: unit, local: null,
      style: { fontFamily: '', fontSize: 0, fontWeight: 400, letterSpacing: 0, lineHeight: 1.2, color: '', textAlign: '', background: '', radius: 0 },
    }
  }
  function describe(el) {
    var rootBox = rootOrigin()
    var r = el.getBoundingClientRect()
    var cs = getComputedStyle(el)
    var visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.01
    // walk up for hidden clips / zero opacity ancestors
    for (var p = el.parentElement; visible && p && p !== document.body; p = p.parentElement) {
      var pcs = getComputedStyle(p)
      if (pcs.visibility === 'hidden' || pcs.display === 'none' || parseFloat(pcs.opacity) <= 0.01) visible = false
    }
    var up = el.parentElement && el.parentElement.closest('[data-ms-id]')
    var depth = depthOf(el)
    var unwrapped = el.hasAttribute('data-ms-unwrappable')
    var id = el.getAttribute('data-ms-id')
    var o = EL[id] || {}
    var w = wrapperOf(el)
    var pivot = null, base = null, local = null
    var g = GEO[id]
    if (w && g && w.parentElement) {
      try { local = maskSpace(el, w, g, rootBox).map(function (x) { return +x.toFixed(4) }) } catch (e) { local = null }
      // the untransformed box and the pivot, in composition px (the designer's offset at this moment included)
      var pr = w.parentElement.getBoundingClientRect()
      var wcs = getComputedStyle(w)
      var ox = pr.left - rootBox.left, oy = pr.top - rootBox.top
      base = { x: ox + g.l, y: oy + g.t, w: g.w, h: g.h }
      pivot = { x: ox + g.l + g.w / 2 + cssNum(wcs, '--ms-ax') + cssNum(wcs, '--ms-x'), y: oy + g.t + g.h / 2 + cssNum(wcs, '--ms-ay') + cssNum(wcs, '--ms-y') }
    }
    var m = mediaOf(el)
    return {
      id: id,
      label: o.label || el.getAttribute('data-ms-label') || id,
      type: el.getAttribute('data-ms-type') || (el.tagName === 'IMG' ? 'image' : el.tagName === 'VIDEO' ? 'video' : 'shape'),
      tag: el.tagName.toLowerCase(),
      designer: el.getAttribute('data-ms-designer') || (el.hasAttribute('data-ms-copy-of') ? 'copy' : null),
      copyOf: el.getAttribute('data-ms-copy-of') || null,
      parent: up ? up.getAttribute('data-ms-id') : null,
      depth: depth,
      stack: stackKeyOf(el),
      rank: stackRank(el),
      // wrapped elements take move/scale/rotate; nested flow elements move only
      movable: !unwrapped || el.getAttribute('data-ms-unwrappable') !== 'sticky',
      transformable: !unwrapped,
      visible: visible,
      rect: { x: r.left - rootBox.left, y: r.top - rootBox.top, w: r.width, h: r.height },
      base: base,
      pivot: pivot,
      local: local,
      rig: rigOf(el),
      src: m ? m.getAttribute('src') || '' : undefined,
      text: (el.getAttribute('data-ms-type') === 'text') ? el.innerText : undefined,
      // a styled line's parts (a word in another colour…), when it has a few
      runs: (el.getAttribute('data-ms-type') === 'text') ? (function () { var ns = textNodes(el); return ns.length > 1 && ns.length <= 12 ? ns.map(function (n) { return n.nodeValue }) : undefined })() : undefined,
      auto: el.hasAttribute('data-ms-auto') || undefined,
      style: {
        fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10),
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
        lineHeight: cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
        color: cs.color, textAlign: cs.textAlign, background: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) || 0,
      },
    }
  }
  /** on screen at this moment: not hidden, not faded out (its own opacity and every parent's, wrappers included) */
  function shownNow(el) {
    var cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      var pcs = p === el ? cs : getComputedStyle(p)
      if (pcs.display === 'none' || parseFloat(pcs.opacity) <= 0.01) return false
    }
    return true
  }
  /** a layer draws something itself: a picture, its own text, a fill, a border or a shadow */
  function paintsItself(el) {
    if (/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(el.tagName) || el.tagName.toLowerCase() === 'svg' || el.closest('svg')) return true
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) return true
    var cs = getComputedStyle(el)
    var seen = function (c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return !!c && c !== 'transparent'; var a = m[1].split(',')[3]; return a == null || parseFloat(a) > 0 }
    return seen(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none') || (parseFloat(cs.borderTopWidth) > 0 && seen(cs.borderTopColor)) || (cs.boxShadow && cs.boxShadow !== 'none')
  }
  /**
   * The layers at a point, top first, as the designer sees them now (After Effects picks the top
   * layer with pixels there): layers faded out or hidden at this moment are skipped, and the bare
   * area of a container (a scene group that draws nothing itself) comes after what is drawn.
   * The app's wrappers and the composition may turn pointer events off — the test ignores that.
   */
  function hitAt(x, y) {
    var st = document.createElement('style')
    st.textContent = '*{pointer-events:auto !important}'
    document.head.appendChild(st)
    var hits
    try { hits = document.elementsFromPoint(x, y) } finally { st.remove() }
    var ids = [], bare = []
    for (var h = 0; h < hits.length; h++) {
      var e = hits[h]
      // the app's own wrappers fill their parent but draw nothing
      if (!e.closest || (e.hasAttribute && e.hasAttribute('data-ms-wrap-for'))) continue
      // a character part first (the editor picks it once its character is picked)
      var part = e.closest('[data-ms-part]')
      if (part && shownNow(part) && ids.indexOf(part.getAttribute('data-ms-part')) < 0) ids.push(part.getAttribute('data-ms-part'))
      var host = e.closest('[data-ms-id]')
      if (!host) continue
      var hid = host.getAttribute('data-ms-id')
      if (ids.indexOf(hid) >= 0 || !shownNow(e)) continue
      if (e === host && !paintsItself(host)) { if (bare.indexOf(hid) < 0) bare.push(hid); continue }
      ids.push(hid)
    }
    return ids.concat(bare.filter(function (id) { return ids.indexOf(id) < 0 }))
  }
  function listElements() {
    var out = []
    var list = document.querySelectorAll('[data-ms-id]')
    RANKS = new Map()
    try {
      for (var i = 0; i < list.length; i++) out.push(describe(list[i]))
      var rb = rootOrigin()
      Object.keys(PARTS).forEach(function (pid, k) { try { out.push(describePart(pid, rb, k)) } catch (e) { /* a part that left the page */ } })
    } finally {
      RANKS = null
    }
    return out
  }
  /**
   * Content the designer cannot edit on its own: text or pictures that belong
   * directly to a group (or to an element that also contains editable children),
   * e.g. a phone mockup whose screen copy has no data-ms-id of its own.
   */
  function looseContent() {
    var out = []
    var list = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (el.hasAttribute('data-ms-auto')) continue
      if (el.getAttribute('data-ms-type') !== 'group' && !el.querySelector('[data-ms-id]')) continue
      if (el.tagName === 'AUDIO') continue
      var text = ''
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        var v = n.nodeValue.replace(/\s+/g, ' ').trim()
        var pe = n.parentElement
        if (!v || !pe || pe.closest('[data-ms-id]:not([data-ms-auto])') !== el || /^(SCRIPT|STYLE)$/.test(pe.tagName)) continue
        text += v + ' '
      }
      var pics = 0
      var media = el.querySelectorAll('img,video')
      for (var k = 0; k < media.length; k++) if (media[k].closest('[data-ms-id]:not([data-ms-auto])') === el && media[k] !== el) pics++
      if (text || pics) out.push({ id: el.getAttribute('data-ms-id'), label: el.getAttribute('data-ms-label') || '', text: text.trim().slice(0, 60), images: pics })
    }
    return out
  }
  /** the editor's solo switch: only these layers (and what holds them) show */
  function solo(ids) {
    var list = document.querySelectorAll('[data-ms-id]')
    var keep = (ids || []).map(function (id) { return document.querySelector('[data-ms-id="' + esc(id) + '"]') }).filter(Boolean)
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      var host = wrapperOf(el) || el
      var on = !keep.length || keep.some(function (k) { return k === el || k.contains(el) || el.contains(k) })
      if (on) host.removeAttribute('data-ms-solo-off')
      else host.setAttribute('data-ms-solo-off', '')
    }
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data
    if (!d || typeof d !== 'object' || !d.ms) return
    var reply = function (payload) {
      payload.ms = d.ms + ':reply'
      payload.reqId = d.reqId
      ev.source && ev.source.postMessage(payload, '*')
    }
    var P = window.__player
    if (d.ms === 'elements') reply({ items: listElements() })
    else if (d.ms === 'timing') {
      var M = window.__MS_TIME_MAP__
      var out = []
      Object.keys(TIMING).forEach(function (id) {
        var r = TIMING[id], el = document.querySelector('[data-ms-id="' + esc(id) + '"]')
        if (!el || !isFinite(r.start)) return
        var a = M ? M.map(r.start) : r.start, b = isFinite(r.end) ? (M ? M.map(r.end) : r.end) : null
        out.push({ id: id, label: (EL[id] && EL[id].label) || el.getAttribute('data-ms-label') || id, type: el.getAttribute('data-ms-type') || '', start: a, end: b })
      })
      reply({ items: out })
    }
    else if (d.ms === 'motions') {
      var MM = window.__MS_TIME_MAP__
      var items = []
      MOTIONS.concat(CSSANIMS).forEach(function (m) {
        if (m.start == null) return
        items.push({
          key: m.key, editKey: m.editKey || m.key, owners: m.owners, self: m.self, type: m.type, sig: m.sig, props: m.props, ease: m.ease,
          duration: m.duration, stagger: m.stagger, staggerEach: m.staggerEach, staggerFrom: m.staggerFrom, staggerCount: m.tween && m.tween.targets ? m.tween.targets().length : 1,
          repeat: m.repeat, yoyo: m.yoyo, shift: m.shift, edited: m.edited, disabled: m.disabled, nested: !!m.nested,
          authoredStart: m.authored != null ? m.authored : m.start - m.shift - (m.layerShift || 0),
          layerShift: m.layerShift || 0,
          start: MM ? MM.map(m.start) : m.start,
          end: MM ? MM.map(m.end) : m.end,
        })
      })
      reply({ items: items, stale: STALE })
    }
    else if (d.ms === 'claude-tracks') reply({ tracks: claudeTracks(String(d.id || ''), d.props) })
    else if (d.ms === 'props-now') reply({ values: propsNow(String(d.id || ''), d.props || []) })
    else if (d.ms === 'measure-flow') reply(measureFlow(String(d.id || '')))
    else if (d.ms === 'play' && P) { took(d); P.play(); postState() }
    else if (d.ms === 'pause' && P) { took(d); P.pause(); postState() }
    else if (d.ms === 'seek' && P) { took(d); P.pause(); P.seek(Math.max(0, +d.t || 0)); postState() }
    else if (d.ms === 'apply-styles') {
      EL = (d.overrides && d.overrides.elements) || {}
      applyStyles(EL)
      reply({ ok: true })
    }
    else if (d.ms === 'solo') {
      solo(d.ids)
      reply({ ok: true })
    }
    else if (d.ms === 'hit') reply({ ids: hitAt(+d.x || 0, +d.y || 0) })
  })

  // ---- 5. transport state for the editor (time, duration, playing) ----------------
  // every state says which of the editor's play / pause / seek commands was the last one done here:
  // the editor drops states that piled up before its latest command
  var cmdSeq = 0
  function took(d) { if (typeof d.seq === 'number') cmdSeq = d.seq }
  function postState() {
    var P = window.__player
    if (!P || window.parent === window) return
    try {
      window.parent.postMessage({ ms: 'state', time: P.getTime(), duration: P.getDuration(), playing: !!P.isPlaying(), seq: cmdSeq }, '*')
    } catch (e) { /* parent gone */ }
  }
  var lastSent = 0
  var wasPlaying = false
  function tick(ts) {
    var P = window.__player
    if (P) {
      var playing = !!P.isPlaying()
      if (playing && ts - lastSent > 60) {
        lastSent = ts
        postState()
      }
      if (!playing && wasPlaying) postState()
      wasPlaying = playing
    }
    requestAnimationFrame(tick)
  }
  if (window.parent !== window) {
    var waited = 0
    var boot = setInterval(function () {
      waited += 50
      if (window.__playerReady && window.__player) {
        clearInterval(boot)
        window.parent.postMessage({ ms: 'ready', duration: window.__player.getDuration() }, '*')
        postState()
        requestAnimationFrame(tick)
      } else if (waited > 15000) {
        clearInterval(boot)
        window.parent.postMessage({ ms: 'error', message: window.__hfStartupError || '영상 런타임을 시작하지 못했어요.' }, '*')
      }
    }, 50)
  }

  window.__MS_RUNTIME__ = {
    version: '2.2.0', overrides: O, listElements: listElements,
    mainDuration: function () { return MAIN_DURATION },
    audit: function () { return { elements: listElements(), loose: looseContent(), stale: STALE } },
    // for the app's tests: what the editor asks for over messages
    motions: function () { return MOTIONS.concat(CSSANIMS).map(function (m) { return { key: m.key, editKey: m.editKey, self: m.self, type: m.type, sig: m.sig, duration: m.duration, edited: m.edited, start: m.start, end: m.end, props: m.props } }) },
    tracks: function (id, props) { return claudeTracks(id, props) },
    measureFlow: function (id) { return measureFlow(id) },
  }
})()
