import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // the tests cover the console build's code too
  define: { __MS_CONSOLE__: 'true' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 20000, globalSetup: ['tests/unit/tmp-setup.ts'] },
})
