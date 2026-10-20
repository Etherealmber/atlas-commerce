import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  base: '/',
  plugins: [react(), cloudflare()],
  resolve: {
    // Single instance — do NOT path-alias react-router (breaks react-router/dom subpath)
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'],
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    cssCodeSplit: true,
    minify: 'esbuild',
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('\\react\\') ||
              id.includes('react-router') ||
              id.includes('scheduler') ||
              id.includes('motion') ||
              id.includes('lucide-react')
            ) {
              return 'vendor-react';
            }
            return 'vendor';
          }
          if (id.includes('/pages/Dashboard')) return 'page-dashboard';
          if (id.includes('/pages/Invoices') || id.includes('/pages/InvoiceDetail')) return 'page-invoices';
          if (id.includes('/pages/Products') || id.includes('/pages/Scan')) return 'page-products';
          if (id.includes('/pages/Settings') || id.includes('/pages/Balance')) return 'page-settings';
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  server: {
    // Dev-server only: accept requests proxied under preview/tunnel hostnames
    // (Vite blocks unknown Host headers by default since the 6.0.9 security patch).
    allowedHosts: true,
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx', './src/pages/Login.tsx'],
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router', 'react-router-dom', 'motion', 'lucide-react'],
  },
});
