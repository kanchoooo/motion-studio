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
 *  - timeRemap: section speed changes via a wrapper timeline scrubbing the
 *               authored one; clip data-start/duration are remapped to match
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
        if (o.timing && o.timing.shift && tw.parent === tl) tw.startTime(Math.max(0, tw.startTime() + o.timing.shift))
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
      // music keeps real time; sound effects stay locked to the picture they accompany
      if (el.tagName === 'AUDIO' && el.getAttribute('data-ms-type') !== 'sfx') continue
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
    applyElementTiming(tl)
    try { collectTiming(tl) } catch (e) { /* timing bars are best effort */ }
    wrapEditables()
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
    return {
      id: el.getAttribute('data-ms-id'),
      label: el.getAttribute('data-ms-label') || el.getAttribute('data-ms-id'),
      type: el.getAttribute('data-ms-type') || (el.tagName === 'IMG' ? 'image' : 'shape'),
      movable: !el.hasAttribute('data-ms-unwrappable'),
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

  window.__MS_RUNTIME__ = { version: '1.1.0', overrides: O, listElements: listElements }
})()
