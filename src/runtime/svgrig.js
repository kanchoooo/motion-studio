/* SvgRig — procedural face/limb helpers for hand-drawn SVG characters (no outlines), HyperFrames-safe.
 * Tagged characters (character_tag): SvgRig.pose(svg, 'head', {rot, s, sx, sy, x, y}) turns a part about its
 * data-pivot within data-max-rot and moves its followers along; SvgRig.eyeRig(svg, 'eye-l', {scale, lookX,
 * lookY, pupil}) drives an eye made with the eye rig; SvgRig.layer(svg, 'hand-l', 'body', 'above'|'below').
 * A character is an inline <svg> inside a host element. Its acting parameters are CSS custom properties on the
 * host (--brow-raise, --eye-open, --look-x, --mouth-open, --head-sq …) so authors (and Motion Studio designers)
 * animate them with ordinary GSAP tweens. Every frame, SvgRig.attach(tl) calls each character's render(P, t)
 * with the current parameter values; render rewrites SVG attributes. Everything depends only on time.
 */
(function () {
  'use strict'
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x }
  function lerp(a, b, t) { return a + (b - a) * t }
  function V(el, name, def) {
    var s = el.style.getPropertyValue(name)
    if (s === '' || s == null) s = getComputedStyle(el).getPropertyValue(name)
    var n = parseFloat(s); return isNaN(n) ? def : n
  }
  function f(n) { return Math.round(n * 10) / 10 }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  function noise(t, s) { s = s || 0; return Math.sin(t * 1.7 + s * 3.1) * 0.5 + Math.sin(t * 2.9 + s * 1.3) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.2 }

  // ---------- eyebrow: thick rounded stroke along a quadratic curve ----------
  // side: -1 left eye, +1 right eye (mirrors tilt). raise: px up. tilt: + = inner end down (angry), - = inner up (worried). arch: px
  function brow(cx, cy, w, side, raise, tilt, arch) {
    var inner = { x: cx - side * w / 2, y: cy - raise + tilt * w * 0.25 }
    var outer = { x: cx + side * w / 2, y: cy - raise - tilt * w * 0.12 }
    var mx = (inner.x + outer.x) / 2, my = (inner.y + outer.y) / 2 - arch * 2
    return 'M' + f(inner.x) + ' ' + f(inner.y) + ' Q' + f(mx) + ' ' + f(my) + ' ' + f(outer.x) + ' ' + f(outer.y)
  }

  // ---------- eye: white + pupil + highlight, upper/lower skin lids, closed / happy line ----------
  // refs: {g, white, pupil, hl, hl2, lid, low, line}; geo: {cx, cy, rx, ry, pr}; side -1/+1
  function eye(r, geo, side, P) {
    var open = clamp(P.open, 0, 1), happy = clamp(P.happy || 0, 0, 1)
    var rx = geo.rx * P.scale, ry = geo.ry * P.scale
    r.g.setAttribute('transform', 'translate(' + f(geo.cx + (P.dx || 0)) + ' ' + f(geo.cy + (P.dy || 0)) + ')')
    r.white.setAttribute('rx', f(rx)); r.white.setAttribute('ry', f(ry))
    if (r.clip) { r.clip.setAttribute('rx', f(rx)); r.clip.setAttribute('ry', f(ry)) }
    var pr = geo.pr * (P.pupil || 1)
    var px = clamp(P.lookX, -1, 1) * (rx - pr * 1.15), py = clamp(P.lookY, -1, 1) * (ry - pr * 1.15)
    r.pupil.setAttribute('cx', f(px)); r.pupil.setAttribute('cy', f(py)); r.pupil.setAttribute('r', f(pr))
    if (r.hl) { r.hl.setAttribute('cx', f(px - pr * 0.35)); r.hl.setAttribute('cy', f(py - pr * 0.4)); r.hl.setAttribute('r', f(pr * 0.32)) }
    if (r.hl2) { r.hl2.setAttribute('cx', f(px + pr * 0.4)); r.hl2.setAttribute('cy', f(py + pr * 0.38)); r.hl2.setAttribute('r', f(pr * 0.14)) }
    // upper lid: skin polygon from above the eye down to the lid line (tilted)
    var lidY = -ry + (1 - open) * 2 * ry, t = (P.lidTilt || 0) * side
    var yIn = lidY + t * rx * 0.6, yOut = lidY - t * rx * 0.6       // inner end = towards the nose
    var xi = -side * (rx + 6), xo = side * (rx + 6)
    r.lid.setAttribute('d', 'M' + f(xi) + ' ' + f(-ry - 8) + ' L' + f(xo) + ' ' + f(-ry - 8) + ' L' + f(xo) + ' ' + f(yOut) + ' L' + f(xi) + ' ' + f(yIn) + ' Z')
    var low = clamp(P.squint || 0, 0, 1), lowY = ry - low * ry * 1.2
    if (r.low) r.low.setAttribute('d', 'M' + f(-rx - 6) + ' ' + f(ry + 8) + ' L' + f(rx + 6) + ' ' + f(ry + 8) + ' L' + f(rx + 6) + ' ' + f(lowY) + ' Q0 ' + f(lowY - low * 10) + ' ' + f(-rx - 6) + ' ' + f(lowY) + ' Z')
    var shut = open < 0.1 || happy > 0.05
    r.white.style.opacity = shut ? 0 : 1
    if (r.inner) r.inner.style.opacity = shut ? 0 : 1
    if (r.line) {
      r.line.style.opacity = shut ? 1 : 0
      if (happy > 0.05) r.line.setAttribute('d', 'M' + f(-rx * 0.8) + ' ' + f(ry * 0.25) + ' Q0 ' + f(-ry * 0.95 * happy) + ' ' + f(rx * 0.8) + ' ' + f(ry * 0.25))
      else r.line.setAttribute('d', 'M' + f(-rx * 0.85) + ' ' + f(ry * 0.05) + ' Q0 ' + f(ry * 0.55) + ' ' + f(rx * 0.85) + ' ' + f(ry * 0.05))
    }
  }

  // ---------- mouth: parametric shape (open, wide, smile, round), returns path strings ----------
  function mouth(cx, cy, base, P) {
    var open = clamp(P.open, 0, 1), sm = clamp(P.smile, -1, 1), rd = clamp(P.round || 0, 0, 1)
    var w = base * (P.wide || 1) * (1 - rd * 0.45) * (1 + Math.max(sm, 0) * 0.2)
    var x0 = cx - w / 2, x1 = cx + w / 2, skew = (P.skew || 0) * w * 0.3
    var corner = cy - sm * w * 0.18
    var depth = open * base * (0.85 + rd * 0.4)
    var top = cy - sm * w * 0.05 - rd * depth * 0.45 + (P.topLift || 0)
    if (depth < 3) {
      var d = 'M' + f(x0) + ' ' + f(corner - skew) + ' Q' + f(cx) + ' ' + f(cy + sm * w * 0.38) + ' ' + f(x1) + ' ' + f(corner + skew)
      return { line: d, fill: '', tongue: '', teeth: '' }
    }
    var bot = cy + depth
    var fill = 'M' + f(x0) + ' ' + f(corner - skew) +
      ' C' + f(x0 + w * 0.2) + ' ' + f(top - rd * 6) + ' ' + f(x1 - w * 0.2) + ' ' + f(top - rd * 6) + ' ' + f(x1) + ' ' + f(corner + skew) +
      ' C' + f(x1 + rd * w * 0.12) + ' ' + f(bot - depth * 0.1) + ' ' + f(cx + w * 0.3) + ' ' + f(bot + depth * 0.15) + ' ' + f(cx) + ' ' + f(bot + depth * 0.12) +
      ' C' + f(cx - w * 0.3) + ' ' + f(bot + depth * 0.15) + ' ' + f(x0 - rd * w * 0.12) + ' ' + f(bot - depth * 0.1) + ' ' + f(x0) + ' ' + f(corner - skew) + ' Z'
    var tongue = 'M' + f(cx - w * 0.32) + ' ' + f(bot + depth * 0.2) + ' Q' + f(cx) + ' ' + f(bot - depth * 0.55) + ' ' + f(cx + w * 0.32) + ' ' + f(bot + depth * 0.2) + ' Z'
    var teeth = sm > 0.2 && open > 0.25 ? 'M' + f(x0 + w * 0.12) + ' ' + f(top + 2) + ' L' + f(x1 - w * 0.12) + ' ' + f(top + 2) + ' L' + f(x1 - w * 0.16) + ' ' + f(top + depth * 0.22) + ' L' + f(x0 + w * 0.16) + ' ' + f(top + depth * 0.22) + ' Z' : ''
    return { line: '', fill: fill, tongue: tongue, teeth: teeth }
  }

  // ---------- jointless tapered limb (sleeve) from S to E with a bow ----------
  function limb(S, E, w0, w1, bend) {
    var dx = E.x - S.x, dy = E.y - S.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L
    var mx = (S.x + E.x) / 2 + nx * bend, my = (S.y + E.y) / 2 + ny * bend
    var a = w0 / 2, b = w1 / 2
    return 'M' + f(S.x + nx * a) + ' ' + f(S.y + ny * a) +
      ' Q' + f(mx + nx * (a + b) / 2) + ' ' + f(my + ny * (a + b) / 2) + ' ' + f(E.x + nx * b) + ' ' + f(E.y + ny * b) +
      ' A' + f(b) + ' ' + f(b) + ' 0 0 0 ' + f(E.x - nx * b) + ' ' + f(E.y - ny * b) +
      ' Q' + f(mx - nx * (a + b) / 2) + ' ' + f(my - ny * (a + b) / 2) + ' ' + f(S.x - nx * a) + ' ' + f(S.y - ny * a) +
      ' A' + f(a) + ' ' + f(a) + ' 0 0 0 ' + f(S.x + nx * a) + ' ' + f(S.y + ny * a) + ' Z'
  }

  // ---------- blink schedule (deterministic) ----------
  function autoBlink(t, seed, every) {
    var r = mulberry32(seed || 1), tt = 0.6 + r() * 1.2, v = 0
    while (tt < t + 1) { var d = t - tt; if (d >= 0 && d < 0.15) v = Math.max(v, 1 - Math.abs(d - 0.06) / 0.08); tt += (every || 2.6) + r() * 1.8 }
    return clamp(v, 0, 1)
  }

  // ---------- tagged parts (character_tag): pose about data-pivot, followers, eye rig, layer order ----------
  function nums(s) { return (s || '').trim().split(/\s+/).map(Number) }
  function byId(root, id) { return root.querySelector('[id="' + String(id).replace(/["\\]/g, '\\$&') + '"]') }
  /** rotate / scale / move a tagged part about its own pivot; the angle stays within data-max-rot;
   *  elements with data-follow="<id>" (e.g. the chin shadow) get the same transform */
  function pose(root, id, p) {
    var el = byId(root, id); if (!el) return
    var pv = nums(el.getAttribute('data-pivot')), px = pv[0] || 0, py = pv[1] || 0
    var max = parseFloat(el.getAttribute('data-max-rot'))
    var rot = p.rot || 0; if (!isNaN(max)) rot = clamp(rot, -max, max)
    var sx = p.sx == null ? (p.s == null ? 1 : p.s) : p.sx, sy = p.sy == null ? (p.s == null ? 1 : p.s) : p.sy
    var t = 'translate(' + f((p.x || 0) + px) + ' ' + f((p.y || 0) + py) + ') rotate(' + f(rot) + ') scale(' + Math.round(sx * 1000) / 1000 + ' ' + Math.round(sy * 1000) / 1000 + ') translate(' + f(-px) + ' ' + f(-py) + ')'
    el.setAttribute('transform', t)
    root.querySelectorAll('[data-follow="' + id + '"]').forEach(function (x) { x.setAttribute('transform', t) })
  }
  /** an eye made with the eye rig: scale (surprise 1.2–1.35), look (-1…1 each way), pupil size (0.6–1.2).
   *  The white is the whole eye, the pupil is clipped inside it, so nothing tears open */
  function eyeRig(root, id, p) {
    var el = byId(root, id); if (!el) return
    var g = nums(el.getAttribute('data-eye')), cx = g[0], cy = g[1], rx = g[2], ry = g[3]
    var sc = clamp(p.scale == null ? 1 : p.scale, 0.5, 1.4)
    el.setAttribute('transform', 'translate(' + f(cx) + ' ' + f(cy) + ') scale(' + Math.round(sc * 1000) / 1000 + ') translate(' + f(-cx) + ' ' + f(-cy) + ')')
    var pupil = byId(root, id.replace(/^eye-/, 'pupil-')) || el.querySelector('[id^="pupil"]')
    var c = pupil && pupil.querySelector('[data-role="content"]'); if (!c) return
    var pv = nums(pupil.getAttribute('data-pivot')), px = pv[0] || cx, py = pv[1] || cy
    var ps = clamp(p.pupil == null ? 1 : p.pupil, 0.5, 1.3)
    // the pupil stays mostly inside the white: travel = 45% of the eye radius
    var dx = clamp(p.lookX || 0, -1, 1) * rx * 0.45, dy = clamp(p.lookY || 0, -1, 1) * ry * 0.45
    c.setAttribute('transform', 'translate(' + f(px + dx) + ' ' + f(py + dy) + ') scale(' + Math.round(ps * 1000) / 1000 + ') translate(' + f(-px) + ' ' + f(-py) + ')')
  }
  /** put a part just above or below another one (moves the element only when the order changes). A part inside
   *  a group (a hand in its arm) moves with its whole branch, so it never leaves the group it turns with */
  function layer(root, id, refId, where) {
    var el = outer(byId(root, id)), ref = outer(byId(root, refId)); if (!el || !ref || el === ref) return
    while (el && el.parentNode !== ref.parentNode) el = el.parentNode
    if (!el || el === ref || !el.parentNode || el === root) return
    if (where === 'below') { if (el.nextElementSibling !== ref) ref.parentNode.insertBefore(el, ref) }
    else if (ref.nextElementSibling !== el) ref.parentNode.insertBefore(el, ref.nextSibling)
  }

  /** Motion Studio wraps each tagged part in a <g> the designer poses: order by that wrapper */
  function outer(n) { var p = n && n.parentNode; return p && p.getAttribute && p.hasAttribute('data-ms-part') ? p : n }

  var CHARS = []
  var SvgRig = {
    V: V, clamp: clamp, lerp: lerp, noise: noise, rng: mulberry32, brow: brow, eye: eye, mouth: mouth, limb: limb, autoBlink: autoBlink, f: f,
    pose: pose, eyeRig: eyeRig, layer: layer,
    // register a character: host element, default params, render(P, t, host)
    add: function (host, defs, render) {
      for (var k in defs) if (host.style.getPropertyValue('--' + k) === '') host.style.setProperty('--' + k, String(defs[k]))
      CHARS.push({ host: host, keys: Object.keys(defs), defs: defs, render: render })
    },
    /** the registered characters and their acting parameters (Motion Studio's character controls) */
    chars: function () { return CHARS.map(function (c) { return { host: c.host, defs: c.defs } }) },
    drawAll: function (t) {
      CHARS.forEach(function (c) {
        var P = {}
        c.keys.forEach(function (k) { P[k] = V(c.host, '--' + k, c.defs[k]) })
        c.render(P, t, c.host)
      })
    },
    attach: function (tl) {
      var prev = tl.eventCallback('onUpdate')
      tl.eventCallback('onUpdate', function () { if (prev) prev.apply(this, arguments); SvgRig.drawAll(tl.time()) })
      SvgRig.drawAll(tl.time())
      return tl
    }
  }
  window.SvgRig = SvgRig
})()
