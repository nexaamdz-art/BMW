import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    watch: {
      // Don't watch the frame image directories — thousands of files cause OOM
      ignored: [
        '**/public/frames/**',
        '**/public/frames_m/**',
        '**/public/audio/**',
      ]
    }
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0
  }
})
