import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const modules = fileURLToPath(new URL('./node_modules', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: [
      // monaco-vim imports Monaco by paths its package exports no longer map.
      { find: /^monaco-editor\/esm\/(.*?)(\.js)?$/, replacement: join(modules, 'monaco-editor/esm/$1.js') },
      { find: /^monaco-vim$/, replacement: join(modules, 'monaco-vim/dist/index.mjs') },
    ],
  },
  worker: { format: 'es' },
  build: { target: 'safari16', chunkSizeWarningLimit: 8000 },
  server: { host: '127.0.0.1', port: 9245, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] } },
})
