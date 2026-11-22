// Local-only frontend for scripts/capture-demo-shots.mjs; no Worker bindings.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  resolve: { dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'] },
});
