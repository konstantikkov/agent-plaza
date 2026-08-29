import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      // dev: `PLAZA_DEV=1 node api/plaza.js` serves the plaza WebSocket on :8787
      '/api/plaza': {
        target: 'http://localhost:8787',
        ws: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api/plaza': {
        target: 'http://localhost:8787',
        ws: true,
      },
    },
  },
});
