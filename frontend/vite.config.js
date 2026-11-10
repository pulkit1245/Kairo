import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // the backend allows this origin in CORS_ORIGIN
    port: 5173,
    strictPort: true,
    // /api goes to the backend, so the browser only ever talks to one origin
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
