import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /geoserver/* to your real GeoServer, so the browser
// never hits CORS. Set GEOSERVER_TARGET in .env (see .env.example).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.GEOSERVER_TARGET || 'http://localhost:8080';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/geoserver': { target, changeOrigin: true, secure: false },
      },
    },
  };
});
