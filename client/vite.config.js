import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@shared': path.resolve(root, '..', 'shared'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the heavy third-party libraries into their own chunks.
         *
         * They change far less often than our code, so a deploy invalidates the
         * app chunk while the browser keeps the ~400 KB of vendor code it
         * already has. Route-level splitting lives in App.jsx.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-motion': ['motion'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the httpOnly auth cookie is sent without CORS credentials games.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  /**
   * `vite preview` serves the production bundle, and it needs the same proxy.
   *
   * Without it the only way to exercise a production build locally is to point
   * it at a deployed API, so the one code path that behaves differently in
   * production - see `isSelectable` in `lib/api.js`, which stops the admin's
   * business selection reaching customer-facing requests - could not be tested
   * before shipping. It cost an empty storefront on the live site once.
   */
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
