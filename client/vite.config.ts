// Vite build for the browser half.
//
// In production Express serves this build with a catch-all fallback to
// `index.html` (`architecture.md §4.5`) — no nginx, no separate static host. In
// development Vite serves it and proxies `/api` to the same Express process, so
// the session cookie is same-origin in both, exactly as it is on the box.
//
// The service worker is built as its own entry: it is push-only, and bundling it
// with the app would let it pick up module code that assumes a DOM.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `root` defaults to this file's directory, which is `client/`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Express listens on PORT=3000 (`.env.example`).
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: 'index.html',
        // Fixed name: the registration call has to know the URL, and a hashed
        // service-worker filename would change on every deploy.
        sw: 'src/sw.ts',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
