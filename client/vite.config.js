import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
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