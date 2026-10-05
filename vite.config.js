import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: false,
    watch: {
      // Don't watch static asset directories — thousands of frames cause watcher OOM
      ignored: [
        '**/public/**',
        '**/clips/**',
        '**/dist/**',
        '**/.git/**',
      ]
    }
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0
  }
})
