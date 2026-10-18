import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }
// 관제용 판 (MS_CONSOLE=1): the console's web connection and results collection are built in.
// Without it (the regular Mac and Windows builds) that code is left out entirely.
const CONSOLE = process.env.MS_CONSOLE === '1'
const define = { __MS_CONSOLE__: JSON.stringify(CONSOLE) }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    define,
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // sandboxed preloads must be CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
    define,
    // the browser's page (web.html: the web shim first) exists only in the console build
    ...(CONSOLE ? { build: { rollupOptions: { input: { index: resolve('src/renderer/index.html'), web: resolve('src/renderer/web.html') } } } } : {}),
  },
})
