import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'examples',
  resolve: {
    alias: {
      '@visual-storytelling/core': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  build: { outDir: '../site', emptyOutDir: true, assetsInlineLimit: 0 },
});
