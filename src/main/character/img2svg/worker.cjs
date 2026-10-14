/* Runs img2svg off the main thread: the WASM tracer blocks for a few seconds.
 * workerData: { input, outDir, opts } → writes vector.svg, vector_shapes.json,
 * vector_shapes.png, vector_compare.png into outDir and posts the summary. */
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')
const { vectorize, previews } = require('./lib.cjs')

;(async () => {
  const { input, outDir, opts } = workerData
  const r = await vectorize(input, opts)
  const p = await previews(r)
  fs.writeFileSync(path.join(outDir, 'vector.svg'), r.svg)
  fs.writeFileSync(path.join(outDir, 'vector_shapes.json'), JSON.stringify({ width: r.width, height: r.height, background: r.background, shapes: r.shapes }, null, 1))
  fs.writeFileSync(path.join(outDir, 'vector_shapes.png'), p.sheet)
  fs.writeFileSync(path.join(outDir, 'vector_compare.png'), p.compare)
  parentPort.postMessage({ ok: true, shapes: r.shapes.length, badPct: p.badPct, width: r.width, height: r.height, background: !!r.background })
})().catch((e) => parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) }))
