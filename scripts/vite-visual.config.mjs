// Local screenshot frontend: all API requests stay on the disposable Worker.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  resolve: { dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'] },
});
