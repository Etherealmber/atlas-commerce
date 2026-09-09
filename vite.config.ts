import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  base: '/',
  plugins: [react(), cloudflare()],
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
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) {
              return 'vendor-react';
            }
            return 'vendor';
          }
          // Split heavy pages so first paint stays light
          if (id.includes('/pages/Dashboard')) return 'page-dashboard';
          if (id.includes('/pages/Invoices') || id.includes('/pages/InvoiceDetail')) return 'page-invoices';
          if (id.includes('/pages/Products') || id.includes('/pages/Scan')) return 'page-products';
          if (id.includes('/pages/Settings') || id.includes('/pages/Balance')) return 'page-settings';
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false, // never ship source maps to production
  },
  server: {
    // Faster HMR
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx', './src/pages/Login.tsx'],
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});
