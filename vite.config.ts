import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_BACKEND_PORT } from './shared/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${DEFAULT_BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${DEFAULT_BACKEND_PORT}`,
        ws: true,
      },
    },
  },
});
