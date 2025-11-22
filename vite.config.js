import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext' // Modern tarayıcıları ve import.meta sözdizimini destekle
  },
  esbuild: {
    target: 'esnext' // Esbuild hedefini de güncelle
  }
});
