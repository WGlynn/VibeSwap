import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 3001,
    proxy: {
      '/web': 'http://localhost:8080',
      '/router': 'http://localhost:8080',
    },
  },
});
