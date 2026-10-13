/* Motion Studio runtime (PoC)
 * Applies designer overrides (window.__MS_OVERRIDES__) on top of an
 * agent-authored HyperFrames composition without touching its source.
 *
 *  - style:     typography/colour via an !important stylesheet
 *  - transform: offset/scale/rotate on an invisible wrapper the runtime puts
 *               around each absolutely-positioned editable element. GSAP never
 *               targets the wrapper, so designer moves compose with authored
 *               motion instead of being folded into GSAP's transform cache
 *               (GSAP re-parses computed translate/rotate/scale on invalidate).
 *  - text:      replaced while the parser inserts the node, before the
 *               composition's own scripts (e.g. SplitText) run
 *  - animSpeed: timeScale on every tween that targets the element
 *  - timeRemap: section speed-ups via a wrapper timeline scrubbing the
 *               authored one; clip data-start/duration are remapped to match
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
  function cssValue(k, v) {
    if (typeof v === 'number' && PX[k]) return v + 'px'
    if (k === 'fontFamily') return '"' + String(v).replace(/"/g, '') + '"'
    return String(v)
  }
  var rules = [], transformRules = []
  Object.keys(EL).forEach(function (id) {
    var o = EL[id], sel = '[data-ms-id="' + id.replace(/"/g, '') + '"]'
    var decl = [], inherit = []
    Object.keys(o.style || {}).forEach(function (k) {
      if (!TYPO[k]) return
      var d = TYPO[k] + ':' + cssValue(k, o.style[k]) + ' !important'
      decl.push(d)
      if (k !== 'textAlign') inherit.push(d)
    })
    var t = o.transform, tdecl = []
    if (t) {
      if (t.x || t.y) tdecl.push('translate:' + (t.x || 0) + 'px ' + (t.y || 0) + 'px !important')
      if (t.rotate) tdecl.push('rotate:' + t.rotate + 'deg !important')
      if (t.scale != null && t.scale !== 1) tdecl.push('scale:' + t.scale + ' !important')
    }
    if (tdecl.length) transformRules.push('[data-ms-wrap-for="' + id.replace(/"/g, '') + '"]{' + tdecl.join(';') + '}')
    if (o.hidden) decl.push('visibility:hidden !important')
    if (decl.length) rules.push(sel + '{' + decl.join(';') + '}')
    // agent may split text into spans with their own sizes: force typography down the tree
    if (inherit.length) rules.push(sel + ' *{' + inherit.join(';') + '}')
  })
  function addStyle(id, list) {
    var st = document.createElement('style')
    st.id = id
    st.textContent = list.join('\n')
    ;(document.head || document.documentElement).appendChild(st)
  }
  if (rules.length) addStyle('ms-overrides-css', rules)
  if (transformRules.length) addStyle('ms-overrides-transform', transformRules)

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
    if (root.nodeType !== 1) return
    if (root.hasAttribute('data-ms-id')) applyText(root)
    var list = root.querySelectorAll('[data-ms-id]')
    for (var i = 0; i < list.length; i++) applyText(list[i])
  }
  var hasText = Object.keys(EL).some(function (id) { return EL[id].text != null })
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
    if (!target || target.nodeType !== 1) return null
    var host = target.closest('[data-ms-id]')
    return host ? host.getAttribute('data-ms-id') : null
  }
  function applyElementTiming(tl) {
    var tweens = tl.getChildren(true, true, false)
    tweens.forEach(function (tw) {
      var ids = {}
      tw.targets().forEach(function (t) { var id = ownerId(t); if (id) ids[id] = 1 })
      Object.keys(ids).forEach(function (id) {
        var o = EL[id]
        if (!o) return
        if (o.animSpeed && o.animSpeed !== 1) tw.timeScale(o.animSpeed)
        if (o.timing && o.timing.shift && tw.parent === tl) tw.startTime(tw.startTime() + o.timing.shift)
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
      if (el.tagName === 'AUDIO') continue // music keeps real time
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

  function wrap(id, tl) {
    if (!tl || typeof tl.getChildren !== 'function' || tl.__msWrapped) return tl
    applyElementTiming(tl)
    wrapEditables()
    if (!REMAP.length) return tl
    var rootEl = document.querySelector('[data-composition-id="' + id + '"]')
    var D = rootEl ? parseFloat(rootEl.getAttribute('data-duration')) || tl.duration() : tl.duration()
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
    W.__msMap = M
    window.__MS_TIME_MAP__ = M
    return W
  }

  var store = {}
  var registry = new Proxy(store, {
    set: function (obj, key, value) { obj[key] = wrap(String(key), value); return true }
  })
  window.__timelines = registry
  document.addEventListener('DOMContentLoaded', wrapEditables)
  window.__MS_RUNTIME__ = { version: '0.1.0', overrides: O }
})()
