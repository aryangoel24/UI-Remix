import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      name: 'UiRemixBackground',
      formats: ['iife'],
      fileName: () => 'assets/background.js'
    }
  }
});
