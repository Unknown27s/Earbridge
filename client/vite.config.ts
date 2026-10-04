import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        stub: resolve(__dirname, 'stub.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/peerjs': 'http://localhost:3000',
      '/qr.png': 'http://localhost:3000',
      '/sender-id': 'http://localhost:3000',
    },
  },
})
