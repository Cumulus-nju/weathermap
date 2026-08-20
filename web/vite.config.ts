import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' → 部署到 GitHub Pages 子路径也能正确加载
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
