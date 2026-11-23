import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

function atlasFinanceWasmPlugin(): Plugin {
  const rootDir = process.cwd();
  const buildScript = resolve(rootDir, 'scripts/build-finance-wasm.mjs');
  const rustSrcDir = resolve(rootDir, 'rust/atlas-finance-core/src');
  const rustManifest = resolve(rootDir, 'rust/atlas-finance-core/Cargo.toml');
  const rustToolchain = resolve(rootDir, 'rust-toolchain.toml');

  const runFinanceWasmBuild = () => {
    execFileSync(process.execPath, [buildScript, '--strict'], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  };

  let builtInProcess = false;
  return {
    name: 'atlas-finance-wasm',
    buildStart() {
      // Cache-aware (~15ms on cache hit); ensures even direct `npx vite build` compiles & verifies WASM.
      if (builtInProcess) return;
      builtInProcess = true;
      runFinanceWasmBuild();
    },
    configureServer(server) {
      server.watcher.add([rustSrcDir, rustManifest, rustToolchain]);
      const onRustChange = (changedPath: string) => {
        if (
          changedPath.startsWith(rustSrcDir) ||
          changedPath === rustManifest ||
          changedPath === rustToolchain
        ) {
          try {
            runFinanceWasmBuild();
          } catch (err) {
            server.config.logger.error(
              `[atlas-finance-wasm] Rebuild failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      };
      server.watcher.on('change', onRustChange);
      server.watcher.on('add', onRustChange);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [atlasFinanceWasmPlugin(), react(), cloudflare()],
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
            // Markdown is needed only by the phone Agent, not by the shared app shell.
            if (/[/\\]node_modules[/\\](?:react-markdown|remark-[^/\\]+|rehype-[^/\\]+|unified|micromark[^/\\]*|mdast-[^/\\]+|hast-[^/\\]+|unist-[^/\\]+|vfile[^/\\]*)[/\\]/.test(id)) return 'vendor-markdown';
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
