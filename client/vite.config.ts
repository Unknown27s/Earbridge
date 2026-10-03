import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        sender: resolve(__dirname, 'sender.html'),
        receiver: resolve(__dirname, 'receiver.html'),
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
