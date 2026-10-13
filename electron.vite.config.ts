import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
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
  },
})
