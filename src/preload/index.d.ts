import type { StudioApi } from '@shared/api'

declare global {
  interface Window {
    studio: StudioApi & { internal: { previewBase: string; /** 관제용 웹 연결: the screens in a browser (src/renderer/src/web/shim.ts) */ web?: boolean } }
  }
}
export {}
