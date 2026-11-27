import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createWeatherHandler } from './server/weather.js';

function localWeatherApi() {
  return {
    name: 'wearther-local-weather-api',
    configureServer(server) {
      server.middlewares.use('/api/weather', async (req, res) => {
        await createWeatherHandler()(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite .env 로드: KMA 키는 프런트 번들이 아닌 Node 서버 환경에만 주입합니다.
  const env = loadEnv(mode, process.cwd(), '');
  if (!process.env.KMA_SERVICE_KEY && env.KMA_SERVICE_KEY) {
    process.env.KMA_SERVICE_KEY = env.KMA_SERVICE_KEY;
  }
  return {
    plugins: [react(), localWeatherApi()],
    server: { port: 5173 },
  };
});
