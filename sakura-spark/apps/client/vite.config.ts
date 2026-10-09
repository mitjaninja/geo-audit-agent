import { defineConfig } from 'vite';

export default defineConfig({
  // Mini App открывается по любому пути бота — ассеты только относительные
  base: './',
  build: {
    target: 'es2022',
    // PRD: стартовый бандл до 10 МБ; Phaser — отдельный чанк, чтобы кешировался между релизами
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    chunkSizeWarningLimit: 1600,
  },
  // в разработке API — на сервере (npm run server:dev), Vite проксирует к нему
  server: { host: true, proxy: { '/api': 'http://localhost:8787' } },
});
