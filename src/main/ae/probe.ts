// Runs inside the composition page (hidden window) for the After Effects package:
// lists the layers, samples each one's screen transform and opacity at a time,
// and isolates one layer for a transparent capture. Plain ES5 in a string.
export const AE_PROBE = String.raw`(function () {
  if (window.__msAe) return true
  var root = document.querySelector('[data-composition-id]') || document.body
  var css = document.createElement('style')
  css.textContent = [
    // the chain of a layer (it and its ancestors) without transforms: layout positions
    'html[data-ms-ae-neutral] [data-ms-ae-chain]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}',
    // capture: the chain fully opaque and without its own painting, everything else off
    'html[data-ms-ae-cap], html[data-ms-ae-cap] body{background:transparent!important}',
    'html[data-ms-ae-cap] [data-ms-ae-chain]{opacity:1!important}',
    'html[data-ms-ae-cap] [data-ms-ae-anc]{background:transparent!important;border-color:transparent!important;box-shadow:none!important;outline:none!important;filter:none!important;backdrop-filter:none!important}',
    'html[data-ms-ae-cap] [data-ms-ae-anc]::before, html[data-ms-ae-cap] [data-ms-ae-anc]::after{visibility:hidden!important}',
    'html[data-ms-ae-cap] [data-ms-ae-off]{visibility:hidden!important}',
    // the canvas edge is not a clip here (AE clips to the comp); what lies past it is needed once it moves in
    'html[data-ms-ae-cap], html[data-ms-ae-cap] body, html[data-ms-ae-cap] [data-composition-id]{overflow:visible!important;clip-path:none!important}',
    // the box of a text element without its letters (its background becomes a picture layer)
    'html[data-ms-ae-cap] [data-ms-ae-notext], html[data-ms-ae-cap] [data-ms-ae-notext] *{color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;text-decoration-color:transparent!important}'
  ].join('\n')
  document.head.appendChild(css)

  var LAYERS = []
  var els = document.querySelectorAll('[data-ms-id]')
  for (var i = 0; i < els.length; i++) {
    var el = els[i]
    var type = el.getAttribute('data-ms-type') || ''
    if (el.tagName === 'AUDIO' || /^(sfx|bgm|voice)$/.test(type)) continue
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg' && el.closest('svg') !== el) continue
    LAYERS.push(el)
  }
  function chainOf(el) {
    var c = []
    for (var e = el; e && e !== document.documentElement; e = e.parentElement) c.unshift(e)
    return c
  }
  // every element on some layer's chain is neutralised while measuring layout
  var CHAINS = LAYERS.map(chainOf)
  CHAINS.forEach(function (c) { c.forEach(function (e) { e.setAttribute('data-ms-ae-chain', '') }) })
  LAYERS.forEach(function (el) { el.setAttribute('data-ms-ae-layer', '') })

  var NEUTRAL = null
  function measure() {
    document.documentElement.setAttribute('data-ms-ae-neutral', '')
    var map = new Map()
    CHAINS.forEach(function (c) {
      c.forEach(function (e) {
        if (!map.has(e)) { var r = e.getBoundingClientRect(); map.set(e, { x: r.left, y: r.top, w: r.width, h: r.height }) }
      })
    })
    document.documentElement.removeAttribute('data-ms-ae-neutral')
    return map
  }

  function own(e) {
    var cs = getComputedStyle(e)
    var m = new DOMMatrix()
    if (cs.translate && cs.translate !== 'none') { var t = cs.translate.split(' ').map(parseFloat); m = m.translate(t[0] || 0, t[1] || 0) }
    if (cs.rotate && cs.rotate !== 'none') { var a = parseFloat(cs.rotate); if (!isNaN(a)) m = m.rotate(a) }
    if (cs.scale && cs.scale !== 'none') { var s = cs.scale.split(' ').map(parseFloat); m = m.scale(s[0], s.length > 1 ? s[1] : s[0]) }
    if (cs.transform && cs.transform !== 'none') m = m.multiply(new DOMMatrix(cs.transform))
    var o = cs.transformOrigin.split(' ').map(parseFloat)
    return { m: m, ox: o[0] || 0, oy: o[1] || 0, op: parseFloat(cs.opacity), hidden: cs.visibility === 'hidden' || cs.display === 'none' }
  }

  /** does the element paint anything besides its letters (background, border, shadow)? */
  function paintsBox(el) {
    var cs = getComputedStyle(el)
    var bg = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)
    var alpha = bg ? (bg[1].split(',')[3] !== undefined ? parseFloat(bg[1].split(',')[3]) : 1) : 0
    return alpha > 0 || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) > 0 || cs.boxShadow !== 'none'
  }

  function textInfo(el) {
    var cs = getComputedStyle(el)
    // where the letters are (the element box may be much larger, e.g. a centred button label)
    var range = document.createRange()
    range.selectNodeContents(el)
    var q = range.getBoundingClientRect(), r = el.getBoundingClientRect()
    var centred = cs.textAlign === 'center' || cs.justifyContent === 'center' || cs.placeItems === 'center'
    return {
      bounds: { x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height },
      paints: paintsBox(el),
      text: (el.innerText || '').replace(/ /g, ' '),
      family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic',
      size: parseFloat(cs.fontSize),
      letterSpacing: parseFloat(cs.letterSpacing) || 0,
      lineHeight: cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight),
      color: cs.color,
      align: centred ? 'center' : cs.textAlign
    }
  }

  window.__msAe = {
    layers: function () {
      NEUTRAL = measure()
      document.documentElement.setAttribute('data-ms-ae-neutral', '')
      var out = LAYERS.map(function (el, i) {
        var r = NEUTRAL.get(el)
        var nestedLayer = !!el.querySelector('[data-ms-ae-layer]')
        var kind = el.tagName === 'VIDEO' ? 'video' : el.getAttribute('data-ms-type') === 'text' && !nestedLayer && !el.querySelector('img,video,svg,canvas') ? 'text' : 'raster'
        return {
          index: i,
          id: el.getAttribute('data-ms-id'),
          label: el.getAttribute('data-ms-label') || el.getAttribute('data-ms-id'),
          kind: kind,
          w: r.w, h: r.h,
          src: el.tagName === 'VIDEO' ? el.getAttribute('src') : null,
          videoW: el.videoWidth || 0, videoH: el.videoHeight || 0,
          rate: parseFloat(el.getAttribute('data-playback-rate') || '1') || 1,
          mediaStart: parseFloat(el.getAttribute('data-media-start') || '0') || 0,
          text: kind === 'text' ? textInfo(el) : null
        }
      })
      document.documentElement.removeAttribute('data-ms-ae-neutral')
      return out
    },
    /** screen matrix (a b c d e f) and effective opacity of every layer at the current time */
    sample: function () {
      if (!NEUTRAL) NEUTRAL = measure()
      return CHAINS.map(function (c) {
        var M = new DOMMatrix(), op = 1, hidden = false, prev = null
        for (var k = 0; k < c.length; k++) {
          var e = c[k], r = NEUTRAL.get(e), p = prev ? NEUTRAL.get(prev) : { x: 0, y: 0 }
          var s = own(e)
          M = M.translate(r.x - p.x, r.y - p.y).translate(s.ox, s.oy).multiply(s.m).translate(-s.ox, -s.oy)
          op *= isNaN(s.op) ? 1 : s.op
          if (s.hidden && k === c.length - 1) hidden = true
          if (getComputedStyle(e).display === 'none') hidden = true
          prev = e
        }
        return [M.a, M.b, M.c, M.d, M.e, M.f, hidden ? 0 : op]
      })
    },
    /** isolates layer i for a capture (noText: only its box); returns where its origin is on the canvas */
    isolate: function (i, noText, margin) {
      var el = LAYERS[i], c = CHAINS[i]
      if (noText) el.setAttribute('data-ms-ae-notext', '')
      // room around the canvas (the capture window is larger than the comp)
      document.body.style.setProperty('margin', (margin || 0) + 'px', 'important')
      document.querySelectorAll('[data-ms-ae-off],[data-ms-ae-anc]').forEach(function (e) { e.removeAttribute('data-ms-ae-off'); e.removeAttribute('data-ms-ae-anc') })
      for (var k = 0; k < c.length - 1; k++) {
        c[k].setAttribute('data-ms-ae-anc', '')
        var kids = c[k].children
        for (var j = 0; j < kids.length; j++) if (kids[j] !== c[k + 1] && kids[j] !== document.head) kids[j].setAttribute('data-ms-ae-off', '')
      }
      el.querySelectorAll('[data-ms-ae-layer]').forEach(function (n) { n.setAttribute('data-ms-ae-off', '') })
      document.documentElement.setAttribute('data-ms-ae-neutral', '')
      document.documentElement.setAttribute('data-ms-ae-cap', '')
      var r = el.getBoundingClientRect()
      return { ox: r.left, oy: r.top }
    },
    release: function () {
      document.body.style.removeProperty('margin')
      document.querySelectorAll('[data-ms-ae-off],[data-ms-ae-anc],[data-ms-ae-notext]').forEach(function (e) { e.removeAttribute('data-ms-ae-off'); e.removeAttribute('data-ms-ae-anc'); e.removeAttribute('data-ms-ae-notext') })
      document.documentElement.removeAttribute('data-ms-ae-neutral')
      document.documentElement.removeAttribute('data-ms-ae-cap')
    },
    audio: function () {
      return Array.prototype.map.call(document.querySelectorAll('audio[src]'), function (a) {
        return {
          src: a.getAttribute('src'),
          label: a.getAttribute('data-ms-label') || a.getAttribute('data-ms-type') || 'audio',
          start: parseFloat(a.getAttribute('data-start') || '0') || 0,
          duration: a.getAttribute('data-duration') ? parseFloat(a.getAttribute('data-duration')) : null,
          mediaStart: parseFloat(a.getAttribute('data-media-start') || '0') || 0,
          volume: a.getAttribute('data-volume') != null ? parseFloat(a.getAttribute('data-volume')) : 1
        }
      })
    }
  }
  return true
})()`
