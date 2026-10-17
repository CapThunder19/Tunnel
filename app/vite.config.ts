import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: { 'arkiv-tunnel': fileURLToPath(new URL('../packages/tunnel/src/index.ts', import.meta.url)) },
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
})
