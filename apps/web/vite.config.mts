/// <reference types='vitest' />
import { defineConfig, defaultClientConditions, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { devProxy } from './src/dev-proxy.js';

/** Excalidraw's font files (dist/prod/fonts), served at /fonts so the board never loads them from a CDN. */
function excalidrawFontsDir(): string {
  let dir = dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw'));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  return join(dir, 'dist', 'prod', 'fonts');
}

const fontsDir = normalizePath(excalidrawFontsDir());
// static-copy keeps the directory structure relative to the config root (minus leading ../); strip it so files land in dist/fonts/<Family>/.
const fontsStripBase = normalizePath(relative(import.meta.dirname, fontsDir))
  .replace(/^(\.\.\/)+/, '')
  .split('/').length;

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({ targets: [{ src: `${fontsDir}/**/*`, dest: 'fonts', rename: { stripBase: fontsStripBase } }] }),
    nxReadySignal(),
  ],
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
