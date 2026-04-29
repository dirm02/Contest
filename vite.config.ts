import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Local dev only: fixed UI port + `/api` → dossier server (default 3801). */
const DEV_WEB_PORT = 5173;
const DEFAULT_API_PROXY = 'http://127.0.0.1:3801';
const DEFAULT_SHIP_API_BASE_URL = 'http://localhost:8765';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.DEV_API_PROXY_TARGET || DEFAULT_API_PROXY;
  const shipApiBaseUrl =
    env.VITE_SHIP_API_BASE_URL || env.SHIP_API_BASE_URL || DEFAULT_SHIP_API_BASE_URL;

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_SHIP_API_BASE_URL': JSON.stringify(shipApiBaseUrl),
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash]-challenge-ui.js',
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: DEV_WEB_PORT,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/ship-api': {
          target: shipApiBaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ship-api/, ''),
        },
      },
    },
  };
});
