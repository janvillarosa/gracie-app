import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          antd: ['antd'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@dnd-kit/modifiers'],
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
      // Ratchet floor set just below the current baseline (statements 45.7%,
      // branches 76.8%, functions 75.0%, lines 45.7%). Vitest reads these as
      // percentages (0-100). Raise them as coverage grows; never lower.
      thresholds: { lines: 62, branches: 77, functions: 76, statements: 62 },
    },
  },
})
