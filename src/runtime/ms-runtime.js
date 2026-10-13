/* Motion Studio runtime
 * Applies designer overrides (window.__MS_OVERRIDES__) on top of an
 * agent-authored HyperFrames composition without touching its source, and
 * answers the editor's questions about editable elements over postMessage.
 *
 *  - style:     typography/colour via an !important stylesheet
 *  - transform: offset/scale/rotate on an invisible wrapper the runtime puts
 *               around each absolutely-positioned editable element. GSAP never
 *               targets the wrapper, so designer moves compose with authored
 *               motion instead of being folded into GSAP's transform cache
 *               (GSAP re-parses computed translate/rotate/scale on invalidate).
 *  - text:      replaced while the parser inserts the node, i.e. before the
 *               composition's own scripts (SplitText etc.) run
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

  // ---- 0. motions ---------------------------------------------------------------
  // Tweens are keyed "<owner data-ms-id>#<n>" (n-th tween created for that element)
  // with a signature (kind + animated properties) so an edit is dropped, not
  // misapplied, when Claude rewrites the code.
  var MO = O.motions || {}
  var SPECIAL = {}
  ;('ease duration delay stagger repeat repeatDelay yoyo yoyoEase repeatRefresh paused overwrite immediateRender lazy ' +
    'inherit id data callbackScope startAt runBackwards keyframes reversed clearProps modifiers snap scrollTrigger ' +
    'onStart onStartParams onUpdate onUpdateParams onComplete onCompleteParams onRepeat onRepeatParams ' +
    'onReverseComplete onReverseCompleteParams onInterrupt onInterruptParams parent').split(' ').forEach(function (k) { SPECIAL[k] = 1 })
  var MOTIONS = []
  var MCOUNT = {}
  var STALE = []
  function ownersOf(targets) {
    var arr
    try { arr = window.gsap.utils.toArray(targets) } catch (e) { return [] }
    var seen = {}, out = []
    arr.forEach(function (t) { var id = ownerId(t); if (id && !seen[id]) { seen[id] = 1; out.push(id) } })
    return out
  }
  function propsOf(vars) {
    return Object.keys(vars || {}).filter(function (k) { return !SPECIAL[k] })
  }
  function numeric(v) {
    return typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d*\.?\d+(px|%|deg|rad|turn|rem|em|vw|vh)?\s*$/.test(v))
  }
  function shown(v) {
    if (typeof v === 'function') return 'ƒ'
    if (v && typeof v === 'object') return '…'
    return v
  }
  /** records a tween about to be created and returns vars with designer edits applied */
  function captureMotion(type, targets, a, b) {
    var owners = ownersOf(targets)
    if (!owners.length) return null
    var toVars = type === 'fromTo' ? b : a
    var fromVars = type === 'fromTo' ? a : null
    if (!toVars || typeof toVars !== 'object' || toVars.keyframes) return null
    var props = propsOf(toVars)
    if (fromVars) propsOf(fromVars).forEach(function (k) { if (props.indexOf(k) < 0) props.push(k) })
    if (!props.length) return null
    var primary = owners[0]
    var n = (MCOUNT[primary] = (MCOUNT[primary] || 0) + 1)
    var key = primary + '#' + n
    var sig = type + ':' + props.slice().sort().join(',')
    var rec = {
      key: key, owners: owners, type: type, sig: sig, props: [],
      ease: typeof toVars.ease === 'string' ? toVars.ease : toVars.ease ? 'custom' : '',
      duration: typeof toVars.duration === 'number' ? toVars.duration : 0.5,
      stagger: !!toVars.stagger, shift: 0, edited: false, disabled: false, tween: null,
    }
    props.forEach(function (k) {
      var p = { name: k }
      if (type === 'to') p.to = shown(toVars[k])
      else if (type === 'from') p.from = shown(toVars[k])
      else {
        if (fromVars && k in fromVars) p.from = shown(fromVars[k])
        if (k in toVars) p.to = shown(toVars[k])
      }
      p.editable = (p.from === undefined || numeric(p.from)) && (p.to === undefined || numeric(p.to))
      rec.props.push(p)
    })
    // always pass fresh copies: the copy identifies the created tween (tween.vars === copy)
    toVars = Object.assign({}, toVars)
    if (fromVars) fromVars = Object.assign({}, fromVars)
    var o = MO[key]
    if (o && o.sig !== sig) STALE.push(key)
    else if (o) {
      rec.edited = true
      rec.shift = +o.shift || 0
      if (o.disabled) {
        rec.disabled = true
        props.forEach(function (k) { delete toVars[k]; if (fromVars) delete fromVars[k] })
      } else {
        if (typeof o.duration === 'number' && o.duration >= 0) toVars.duration = o.duration
        if (o.ease) toVars.ease = o.ease
        Object.keys(o.values || {}).forEach(function (vk) {
          var dot = vk.indexOf('.'), side = vk.slice(0, dot), prop = vk.slice(dot + 1), v = o.values[vk]
          if (props.indexOf(prop) < 0) return
          if (type === 'fromTo') { if (side === 'from') fromVars[prop] = v; else toVars[prop] = v }
          else if ((type === 'to' && side === 'to') || (type === 'from' && side === 'from')) toVars[prop] = v
        })
      }
    }
    MOTIONS.push(rec)
    return { rec: rec, a: type === 'fromTo' ? fromVars : toVars, b: toVars }
  }
  function hookGsap() {
    var g = window.gsap
    if (!g || g.__msHooked) return
    g.__msHooked = true
    function wrap(owner, name, isTimeline) {
      var orig = owner[name]
      if (typeof orig !== 'function') return
      owner[name] = function (targets) {
        var args = Array.prototype.slice.call(arguments)
        var r = null
        // legacy signature: (targets, duration, vars[, toVars])
        var legacy = typeof args[1] === 'number'
        var i = legacy ? 2 : 1
        try {
          r = name === 'fromTo' ? captureMotion('fromTo', targets, args[i], args[i + 1]) : captureMotion(name, targets, args[i])
        } catch (e) { r = null }
        if (r) {
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
    ;['to', 'from', 'fromTo'].forEach(function (m) {
      wrap(g, m, false)
      if (g.core && g.core.Timeline) wrap(g.core.Timeline.prototype, m, true)
    })
  }
  hookGsap()
  function inRoot(tw, root) {
    for (var p = tw.parent; p; p = p.parent) if (p === root) return true
    return false
  }
  function finishMotions(tl) {
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

  // ---- 1. style + transform overrides --------------------------------------
  var TYPO = { fontFamily: 'font-family', fontWeight: 'font-weight', fontStyle: 'font-style',
    fontSize: 'font-size', letterSpacing: 'letter-spacing', lineHeight: 'line-height',
    color: 'color', textAlign: 'text-align' }
  var PX = { fontSize: 1, letterSpacing: 1 }
  function esc(id) { return String(id).replace(/["\\]/g, '') }
  function cssValue(k, v) {
    if (typeof v === 'number' && PX[k]) return v + 'px'
    if (k === 'fontFamily') return '"' + String(v).replace(/["\\;{}]/g, '') + '"'
    return String(v).replace(/[;{}]/g, '')
  }
  function buildRules(elements) {
    var typo = [], tf = []
    Object.keys(elements).forEach(function (id) {
      var o = elements[id] || {}, sel = '[data-ms-id="' + esc(id) + '"]'
      var decl = [], inherit = []
      Object.keys(o.style || {}).forEach(function (k) {
        if (!TYPO[k] || o.style[k] == null || o.style[k] === '') return
        var d = TYPO[k] + ':' + cssValue(k, o.style[k]) + ' !important'
        decl.push(d)
        if (k !== 'textAlign') inherit.push(d)
      })
      if (o.hidden) decl.push('visibility:hidden !important')
      if (decl.length) typo.push(sel + '{' + decl.join(';') + '}')
      // compositions may split text into spans with their own sizes: force typography down the tree
      if (inherit.length) typo.push(sel + ' *{' + inherit.join(';') + '}')
      var t = o.transform, tdecl = []
      if (t) {
        if (t.x || t.y) tdecl.push('translate:' + (+t.x || 0) + 'px ' + (+t.y || 0) + 'px')
        if (t.rotate) tdecl.push('rotate:' + (+t.rotate) + 'deg')
        if (t.scale != null && +t.scale !== 1) tdecl.push('scale:' + (+t.scale))
      }
      if (tdecl.length) tf.push('[data-ms-wrap-for="' + esc(id) + '"]{' + tdecl.join(';') + '}')
      // nested elements in normal flow move with relative offsets (layout is untouched)
      if (t && (t.x || t.y)) {
        tf.push(sel + '[data-ms-unwrappable]{position:relative !important;left:calc(var(--ms-l0, 0px) + ' + (+t.x || 0) + 'px) !important;top:calc(var(--ms-t0, 0px) + ' + (+t.y || 0) + 'px) !important}')
      }
    })
    return { typo: typo.join('\n'), tf: tf.join('\n') }
  }
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
    styleTag('ms-overrides-css').textContent = r.typo
    styleTag('ms-overrides-transform').textContent = r.tf
  }
  applyStyles(EL)

  // ---- 1b. edit wrappers ------------------------------------------------------
  var wrapped = false
  function wrapEditables() {
    if (wrapped) return
    wrapped = true
    var list = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (el.parentElement && el.parentElement.hasAttribute('data-ms-wrap-for')) continue
      var cs = getComputedStyle(el)
      if (cs.position !== 'absolute' && cs.position !== 'fixed') {
        if (cs.position === 'relative') {
          // keep the authored offset; designer moves add to it
          el.style.setProperty('--ms-l0', cs.left === 'auto' ? '0px' : cs.left)
          el.style.setProperty('--ms-t0', cs.top === 'auto' ? '0px' : cs.top)
        }
        el.setAttribute('data-ms-unwrappable', cs.position)
        continue
      }
      var w = document.createElement('div')
      w.setAttribute('data-ms-wrap-for', el.getAttribute('data-ms-id'))
      w.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;'
      if (cs.zIndex !== 'auto') w.style.zIndex = cs.zIndex
      el.parentNode.insertBefore(w, el)
      w.appendChild(el)
      // pivot designer scale/rotate on the element's untransformed centre
      w.style.transformOrigin = (el.offsetLeft + el.offsetWidth / 2) + 'px ' + (el.offsetTop + el.offsetHeight / 2) + 'px'
    }
  }

  // ---- 2. text overrides (before the composition's scripts run) ------------
  function applyText(el) {
    var o = EL[el.getAttribute('data-ms-id')]
    if (!o || o.text == null || el.__msTextApplied) return
    el.__msTextApplied = true
    el.textContent = ''
    String(o.text).split('\n').forEach(function (line, i) {
      if (i) el.appendChild(document.createElement('br'))
      el.appendChild(document.createTextNode(line))
    })
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return
    if (root.hasAttribute('data-ms-id')) applyText(root)
    var list = root.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) applyText(list[i])
  }
  var hasText = Object.keys(EL).some(function (id) { return EL[id] && EL[id].text != null })
  if (hasText) {
    // Mutation records are delivered at the microtask checkpoint the parser
    // performs before executing each <script>, i.e. before authored code runs.
    var mo = new MutationObserver(function (recs) {
      recs.forEach(function (r) { r.addedNodes.forEach(scan) })
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', function () { scan(document.body); mo.disconnect() })
  }

  // ---- 3. timeline overrides ------------------------------------------------
  function ownerId(target) {
    if (!target || target.nodeType !== 1 || !target.closest) return null
    var host = target.closest('[data-ms-id]')
    return host ? host.getAttribute('data-ms-id') : null
  }
  function applyElementTiming(tl) {
    tl.getChildren(true, true, false).forEach(function (tw) {
      var ids = {}
      tw.targets().forEach(function (t) { var id = ownerId(t); if (id) ids[id] = 1 })
      Object.keys(ids).forEach(function (id) {
        var o = EL[id]
        if (!o) return
        if (o.animSpeed && o.animSpeed !== 1) tw.timeScale(o.animSpeed)
        if (o.timing && o.timing.shift) {
          // tweens inside scene sub-timelines move too (in their parent's time units)
          var k = 1
          for (var p = tw.parent; p && p !== tl; p = p.parent) k *= p.timeScale() || 1
          tw.startTime(Math.max(0, tw.startTime() + o.timing.shift * k))
        }
      })
    })
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
    tl.getChildren(true, true, false).forEach(function (tw) {
      var s = globalStart(tw, tl)
      var e = s + tw.totalDuration() / (tw.timeScale() || 1)
      tw.targets().forEach(function (t) {
        var id = ownerId(t)
        if (!id) return
        var r = TIMING[id] || (TIMING[id] = { start: Infinity, end: -Infinity })
        r.start = Math.min(r.start, s)
        r.end = Math.max(r.end, e)
      })
    })
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

  function wrapTimeline(id, tl) {
    if (!tl || typeof tl.getChildren !== 'function' || tl.__msWrapped) return tl
    try { finishMotions(tl) } catch (e) { /* motion edits are best effort */ }
    applyElementTiming(tl)
    try { collectTiming(tl) } catch (e) { /* timing bars are best effort */ }
    wrapEditables()
    // registered twice: designer edits must not be applied twice
    tl.__msWrapped = true
    if (!REMAP.length) return tl
    var rootEl = document.querySelector('[data-composition-id="' + esc(id) + '"]')
    // when section speed changes the length, the app writes the output length into
    // data-duration (the renderer reads it statically) and keeps the authored one aside
    var D = rootEl ? parseFloat(rootEl.getAttribute('data-ms-authored-duration') || rootEl.getAttribute('data-duration')) || tl.duration() : tl.duration()
    var M = makeMap(D)
    var finalLen = KEEP_TOTAL ? Math.max(D, M.length) : M.length
    var W = gsap.timeline({ paused: true })
    M.segs.forEach(function (s) {
      W.add(tl.tweenFromTo(s.a, s.b, { duration: (s.b - s.a) / s.k, ease: 'none', immediateRender: false }), s.o)
    })
    if (finalLen > M.length) W.add(tl.tweenFromTo(D, D, { duration: finalLen - M.length, ease: 'none', immediateRender: false }), M.length)
    remapClips(rootEl, M, D, finalLen)
    if (rootEl) rootEl.setAttribute('data-duration', finalLen.toFixed(4))
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

  // ---- 4. editor bridge -------------------------------------------------------
  function compRoot() { return document.querySelector('[data-composition-id]') || document.body }
  function describe(el) {
    var root = compRoot().getBoundingClientRect()
    var r = el.getBoundingClientRect()
    var cs = getComputedStyle(el)
    var visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.01
    // walk up for hidden clips / zero opacity ancestors
    for (var p = el.parentElement; visible && p && p !== document.body; p = p.parentElement) {
      var pcs = getComputedStyle(p)
      if (pcs.visibility === 'hidden' || pcs.display === 'none' || parseFloat(pcs.opacity) <= 0.01) visible = false
    }
    var up = el.parentElement && el.parentElement.closest('[data-ms-id]')
    var depth = 0
    for (var a = up; a; a = a.parentElement && a.parentElement.closest('[data-ms-id]')) depth++
    var unwrapped = el.hasAttribute('data-ms-unwrappable')
    return {
      id: el.getAttribute('data-ms-id'),
      label: el.getAttribute('data-ms-label') || el.getAttribute('data-ms-id'),
      type: el.getAttribute('data-ms-type') || (el.tagName === 'IMG' ? 'image' : 'shape'),
      parent: up ? up.getAttribute('data-ms-id') : null,
      depth: depth,
      // wrapped elements take move/scale/rotate; nested flow elements move only
      movable: !unwrapped || el.getAttribute('data-ms-unwrappable') !== 'sticky',
      transformable: !unwrapped,
      visible: visible,
      rect: { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height },
      text: (el.getAttribute('data-ms-type') === 'text') ? el.innerText : undefined,
      style: {
        fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10),
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
        lineHeight: cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
        color: cs.color, textAlign: cs.textAlign,
      },
    }
  }
  function listElements() {
    var out = []
    var list = document.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) out.push(describe(list[i]))
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
      if (el.getAttribute('data-ms-type') !== 'group' && !el.querySelector('[data-ms-id]')) continue
      if (el.tagName === 'AUDIO') continue
      var text = ''
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        var v = n.nodeValue.replace(/\s+/g, ' ').trim()
        var pe = n.parentElement
        if (!v || !pe || pe.closest('[data-ms-id]') !== el || /^(SCRIPT|STYLE)$/.test(pe.tagName)) continue
        text += v + ' '
      }
      var pics = 0
      var media = el.querySelectorAll('img,video')
      for (var k = 0; k < media.length; k++) if (media[k].closest('[data-ms-id]') === el && media[k] !== el) pics++
      if (text || pics) out.push({ id: el.getAttribute('data-ms-id'), label: el.getAttribute('data-ms-label') || '', text: text.trim().slice(0, 60), images: pics })
    }
    return out
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
        out.push({ id: id, label: el.getAttribute('data-ms-label') || id, type: el.getAttribute('data-ms-type') || '', start: a, end: b })
      })
      reply({ items: out })
    }
    else if (d.ms === 'motions') {
      var MM = window.__MS_TIME_MAP__
      var items = []
      MOTIONS.forEach(function (m) {
        if (m.start == null) return
        items.push({
          key: m.key, owners: m.owners, type: m.type, sig: m.sig, props: m.props, ease: m.ease,
          duration: m.duration, stagger: m.stagger, shift: m.shift, edited: m.edited, disabled: m.disabled,
          authoredStart: m.start - m.shift,
          start: MM ? MM.map(m.start) : m.start,
          end: MM ? MM.map(m.end) : m.end,
        })
      })
      reply({ items: items, stale: STALE })
    }
    else if (d.ms === 'play' && P) { P.play(); postState() }
    else if (d.ms === 'pause' && P) { P.pause(); postState() }
    else if (d.ms === 'seek' && P) { P.pause(); P.seek(Math.max(0, +d.t || 0)); postState() }
    else if (d.ms === 'apply-styles') {
      EL = (d.overrides && d.overrides.elements) || {}
      applyStyles(EL)
      reply({ ok: true })
    }
  })

  // ---- 5. transport state for the editor (time, duration, playing) ----------------
  function postState() {
    var P = window.__player
    if (!P || window.parent === window) return
    try {
      window.parent.postMessage({ ms: 'state', time: P.getTime(), duration: P.getDuration(), playing: !!P.isPlaying() }, '*')
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
    version: '1.2.0', overrides: O, listElements: listElements,
    audit: function () { return { elements: listElements(), loose: looseContent(), stale: STALE } },
  }
})()
