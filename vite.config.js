import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'editor',
  base: './',
  plugins: [react()],
  define: {
    'process.env.IS_PREACT': 'false',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
  },
});
