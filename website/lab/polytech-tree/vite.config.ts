import { defineConfig } from 'vite'
export default defineConfig({
  base: '/lab/polytech-tree/',
  cacheDir: 'H:/CodexStorage/cache/polytech-tree-vite',
  build: { target: 'es2020', rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: { host: '127.0.0.1', port: 4413, strictPort: true },
})
