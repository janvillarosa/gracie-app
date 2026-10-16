import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Dev only: serves MSW's worker script for the opt-in mock trips backend (VITE_MOCK_TRIPS=1),
// so there is nothing to copy into public/ and nothing to ship in a production build.
const mockWorker = (): Plugin => ({
  name: 'serve-msw-worker',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(fs.readFileSync(path.resolve(__dirname, 'node_modules/msw/lib/mockServiceWorker.js')))
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), mockWorker()],
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src/api'),
      '@auth': path.resolve(__dirname, 'src/auth'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@routes': path.resolve(__dirname, 'src/routes'),
      '@lib': path.resolve(__dirname, 'src/lib'),
    },
  },
  build: {
    target: ['es2020', 'safari15', 'chrome90'],
    // The client build's manifest tells scripts/prerender.mjs which stylesheet the landing page
    // needs; the SSR build (the landing page rendered at build time) has no vendor chunks.
    manifest: !isSsrBuild,
    rollupOptions: isSsrBuild
      ? {}
      : {
          output: {
            manualChunks: {
              react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
              antd: ['antd'],
              dnd: [
                '@dnd-kit/core',
                '@dnd-kit/sortable',
                '@dnd-kit/utilities',
                '@dnd-kit/modifiers',
              ],
            },
          },
        },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/setupTests.ts'],
    css: false,
    globals: true,
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      // The dev-only mock worker and its seed data are exercised by hand, not by tests.
      // Setting exclude replaces Vitest's defaults, so build output is listed again: `make check`
      // builds before it tests, and minified bundles would otherwise count as untested functions.
      exclude: ['src/mocks/browser.ts', 'src/mocks/seed.ts', 'dist/**', 'dist-ssr/**', 'coverage/**'],
      // Ratchet floor set just below the current baseline (statements 45.7%,
      // branches 76.8%, functions 75.0%, lines 45.7%). Vitest reads these as
      // percentages (0-100). Raise them as coverage grows; never lower.
      thresholds: { lines: 92, branches: 90, functions: 85, statements: 92 },
    },
  },
}))
