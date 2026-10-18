// 관제용 판's web connection: in a browser there is no Electron preload, so window.studio is made
// here and talks to the app over HTTP (src/main/web.ts); then the app starts. Only the browser's
// page (web.html, built with MS_CONSOLE=1) loads this. Every URL is relative to the page: the
// console relays it under its own path and adds the token.
//
// The method → channel table (src/shared/web-channels.ts) follows src/preload/index.ts
// (tests/unit/web-shim.test.ts compares the two). What a browser does differently: files are
// uploaded (pickFiles, dropped files), shown files are downloaded (reveal), links open in the
// browser, sign-ins are done on the Mac.
import type { AiLoginEvent } from '@shared/ai'
import type { StudioApi, UpdateCheck } from '@shared/api'
import { EVENTS, INVOKE, SENDS } from '@shared/web-channels'

const MAC_ONLY = '로그인은 맥에서 해 주세요. 웹에서는 쓸 수 없어요.'
// what the file pickers offer (the app checks the files again)
const IMAGES = '.png,.jpg,.jpeg,.webp,.gif'
const ACCEPT: Record<string, string> = {
  assets: `${IMAGES},.svg,.avif,.mp4,.mov,.webm,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.psd`,
  images: IMAGES,
  media: `${IMAGES},.mp4,.mov,.webm,.m4v,.mkv`,
  any: '',
}

if (typeof window !== 'undefined' && !('studio' in window)) {
  install()
  // the app itself only now (a static import would run before this module)
  void import('../main')
}

function install() {
  // ---- preview URLs: the app says ./preview/…, the page needs them absolute (iframes, media) ----
  const webBase = new URL('./preview', document.baseURI).href.replace(/\/$/, '')
  const fromApp = (text: string) => text.split('"./preview/').join(`"${webBase}/`)
  const toApp = (text: string) => text.split(`"${webBase}/`).join('"./preview/')

  // ---- small notices of the shim's own (uploads, the connection) ----
  const box = (id: string, css: string) => {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.style.cssText = css
      document.body.appendChild(el)
    }
    return el
  }
  const PILL = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;padding:9px 16px;border-radius:999px;background:rgba(24,24,27,.92);color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Pretendard",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  const notice = (text: string) => {
    const el = box('ms-web-notice', PILL)
    el.textContent = text
    el.style.display = ''
    clearTimeout(Number(el.dataset.t))
    el.dataset.t = String(setTimeout(() => (el.style.display = 'none'), 4000))
  }

  // ---- uploads ----
  const uploading = new Map<XMLHttpRequest, { name: string; done: number }>()
  const showUploads = () => {
    const el = box('ms-web-upload', PILL)
    if (!uploading.size) return void (el.style.display = 'none')
    const [first] = uploading.values()
    el.style.display = ''
    el.textContent = `파일 올리는 중 · ${first.name}${uploading.size > 1 ? ` 외 ${uploading.size - 1}개` : ''} · ${Math.round(first.done * 100)}%`
  }
  const upload = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `./api/upload?name=${encodeURIComponent(file.name)}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (e) => {
        uploading.set(xhr, { name: file.name, done: e.lengthComputable ? e.loaded / e.total : 0 })
        showUploads()
      }
      const done = () => {
        uploading.delete(xhr)
        showUploads()
      }
      xhr.onload = () => {
        done()
        try {
          const r = JSON.parse(xhr.responseText) as { ok: boolean; path?: string; error?: string }
          if (r.ok && r.path) return resolve(r.path)
          reject(new Error(r.error || '파일을 올리지 못했어요.'))
        } catch {
          reject(new Error('파일을 올리지 못했어요.'))
        }
      }
      xhr.onerror = () => {
        done()
        reject(new Error('파일을 올리지 못했어요. 연결을 확인해 주세요.'))
      }
      uploading.set(xhr, { name: file.name, done: 0 })
      showUploads()
      xhr.send(file)
    })
  /** the browser's file picker (called from the click, as browsers require) */
  const pick = (accept: string, multiple: boolean): Promise<File[]> =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = multiple
      if (accept) input.accept = accept
      input.style.display = 'none'
      document.body.appendChild(input)
      const done = (files: File[]) => {
        input.remove()
        resolve(files)
      }
      input.addEventListener('change', () => done([...(input.files ?? [])]))
      input.addEventListener('cancel', () => done([]))
      input.click()
    })
  // a dropped or pasted file: a stand-in path now (pathForFile is synchronous), uploaded when a
  // request carries it; the name stays at the end (callers look at the extension)
  const dropped = new Map<string, File>()
  const sent = new Map<string, Promise<string>>()
  let seq = 0
  const pathForFile = (file: File) => {
    const key = `web-file:${++seq}/${file.name}`
    dropped.set(key, file)
    return key
  }
  const resolveFiles = async (v: unknown): Promise<unknown> => {
    if (typeof v === 'string') {
      const f = dropped.get(v)
      if (!f) return v
      if (!sent.has(v)) sent.set(v, upload(f))
      return sent.get(v)
    }
    if (Array.isArray(v)) return Promise.all(v.map(resolveFiles))
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) out[k] = await resolveFiles(x)
      return out
    }
    return v
  }

  // ---- requests ----
  const invoke = async (channel: string, args: unknown[]): Promise<unknown> => {
    const resolved = dropped.size ? await resolveFiles(args) : args
    let r: Response
    try {
      r = await fetch('./api/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: toApp(JSON.stringify({ channel, args: resolved })) })
    } catch {
      throw new Error('맥의 모션스튜디오에 연결할 수 없어요.')
    }
    const text = await r.text()
    let body: { ok?: boolean; result?: unknown; error?: string; offline?: boolean }
    try {
      body = JSON.parse(fromApp(text))
    } catch {
      throw new Error(`맥의 모션스튜디오에 연결할 수 없어요 (${r.status}).`)
    }
    if (body.offline) throw new Error('맥의 모션스튜디오가 꺼져 있어요.')
    if (!body.ok) throw new Error(body.error || '알 수 없는 오류가 났어요.')
    return body.result
  }
  // in order (keystrokes): one request at a time, keystrokes waiting meanwhile go together
  const queue: { channel: string; args: unknown[] }[] = []
  let sending = false
  const send = (channel: string, args: unknown[]) => {
    const last = queue[queue.length - 1]
    if (channel === 'terminal:write' && last?.channel === channel && last.args[0] === args[0]) last.args[1] = String(last.args[1]) + String(args[1])
    else queue.push({ channel, args })
    if (sending) return
    sending = true
    void (async () => {
      while (queue.length) {
        const m = queue.shift()!
        await fetch('./api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {})
      }
      sending = false
    })()
  }

  // ---- events (server-sent); a lost connection shows a notice and the page reloads once it is back ----
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const emit = (channel: string, payload: unknown) => {
    for (const cb of listeners.get(channel) ?? []) cb(payload)
  }
  const subscribe = (channel: string) => (cb: (p: unknown) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(cb)
    return () => void listeners.get(channel)!.delete(cb)
  }
  let lost = false
  let retry = 1000
  const showLost = (on: boolean) => {
    const el = box('ms-web-lost', 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);color:#fff;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Pretendard",sans-serif;text-align:center')
    el.textContent = '맥의 모션스튜디오와 다시 연결하는 중이에요…'
    el.style.display = on ? 'flex' : 'none'
  }
  const connect = () => {
    const es = new EventSource('./api/events')
    for (const ns of Object.values(EVENTS))
      for (const channel of Object.values(ns))
        es.addEventListener(channel, (e) => {
          try {
            emit(channel, JSON.parse(fromApp((e as MessageEvent<string>).data)))
          } catch {
            /* a broken event */
          }
        })
    es.onopen = () => {
      retry = 1000
      if (lost) location.reload()
    }
    es.onerror = () => {
      lost = true
      showLost(true)
      // the console answers 503 while the app is off: the browser then gives up, so try again here
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 10_000)
      }
    }
  }
  if (document.body) connect()
  else document.addEventListener('DOMContentLoaded', connect)

  // ---- the API ----
  const api: Record<string, Record<string, unknown>> = {}
  for (const [ns, methods] of Object.entries(INVOKE)) {
    api[ns] = {}
    for (const m of methods) api[ns][m] = (...args: unknown[]) => invoke(`${ns}:${m}`, args)
  }
  for (const [ns, map] of Object.entries(EVENTS)) for (const [m, channel] of Object.entries(map)) api[ns][m] = subscribe(channel)
  for (const [ns, map] of Object.entries(SENDS)) for (const [m, channel] of Object.entries(map)) api[ns][m] = (...args: unknown[]) => send(channel, args)

  const download = (path: string) => {
    const a = document.createElement('a')
    a.href = `./api/file?path=${encodeURIComponent(path)}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  Object.assign(api.app, {
    // the console updates the app (or the hidden app does it itself): the page never waits for it
    checkUpdate: async (): Promise<UpdateCheck> => ({ status: 'skipped', current: ((await invoke('app:info', [])) as { version: string }).version }),
    pickFiles: async (kind: string) => Promise.all((await pick(ACCEPT[kind] ?? '', true)).map(upload)),
    pathForFile,
    pickFolder: async () => null,
    reveal: async (path: string) => download(path),
    openExternal: async (url: string) => {
      if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    },
    // the app draws the marked frame itself (a browser cannot capture the preview)
    capture: async () => '',
    login: async () => {
      notice(MAC_ONLY)
      throw new Error(MAC_ONLY)
    },
  })
  Object.assign(api.projects, {
    importShare: async (file?: string, folder?: string) => {
      let path = file
      if (!path) {
        const [f] = await pick('.msshare', false)
        if (!f) return null
        path = await upload(f)
      }
      return invoke('projects:importShare', [path, folder])
    },
  })
  const loginRefused = (provider: unknown) => {
    notice(MAC_ONLY)
    // the connections window waits for how the sign-in went
    setTimeout(() => emit('ai:login', { provider, status: 'error', message: MAC_ONLY } as AiLoginEvent), 0)
  }
  Object.assign(api.ai, {
    login: async (provider: unknown) => loginRefused(provider),
    artlistLogin: async () => {
      notice(MAC_ONLY)
      throw new Error(MAC_ONLY)
    },
  })
  api.internal = { previewBase: webBase, web: true }
  ;(window as unknown as { studio: StudioApi }).studio = api as unknown as StudioApi
}
