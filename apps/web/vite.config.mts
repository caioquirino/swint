/// <reference types='vitest' />
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';
import { devProxy } from './src/dev-proxy';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  plugins: [react(), tailwindcss(), nxReadySignal()],
  resolve: { conditions: ['swint', ...defaultClientConditions] },
  server: {
    port: 4200,
    strictPort: true,
    host: 'localhost',
    proxy: devProxy(process.env.SWINT_API_URL ?? 'http://localhost:3000'),
  },
  preview: { port: 4300, host: 'localhost' },
  build: { outDir: './dist', emptyOutDir: true, reportCompressedSize: true },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default'],
  },
}));
