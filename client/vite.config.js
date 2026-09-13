import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

let buildNumber = 1;
try {
  buildNumber = parseInt(readFileSync(new URL('./.build-number', import.meta.url), 'utf8').trim(), 10) || 1;
} catch (e) {}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000'
    }
  }
});