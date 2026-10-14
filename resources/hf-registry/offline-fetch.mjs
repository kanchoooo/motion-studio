// Motion Studio: the HyperFrames registry ships inside the app (scripts/fetch-registry.mjs puts
// it next to this file). The app starts the HyperFrames CLI with `--import` of this file, so
// registry requests (`hyperframes add`, `hyperframes catalog`) are answered from that copy:
// at once, without a network, and the registry of the HyperFrames version the app bundles.
// Anything not in the copy still goes to the network.
import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const mirror = join(dirname(fileURLToPath(import.meta.url)), 'mirror')
const TYPES = {
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

/** the file in the copy that answers a registry URL, or null */
export function mirrorFile(href, root = mirror) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.search) return null
  let rel = null
  const path = decodeURIComponent(url.pathname)
  const raw = url.hostname === 'raw.githubusercontent.com' && path.match(/^\/heygen-com\/hyperframes\/[^/]+\/registry\/(.+)$/)
  if (raw) rel = join('registry', raw[1])
  else if (url.hostname === 'static.heygen.ai') rel = join('static.heygen.ai', path.slice(1))
  if (!rel) return null
  const file = normalize(join(root, rel))
  if (!file.startsWith(root + sep)) return null
  try {
    return statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

const network = globalThis.fetch
globalThis.fetch = async function fetchFromCopy(input, init) {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
  const file = href ? mirrorFile(href) : null
  if (!file) return network(input, init)
  return new Response(readFileSync(file), { status: 200, headers: { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' } })
}
