import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
  build: { rollupOptions: { output: { manualChunks: { renderer: ['three'], camera: ['three/addons/controls/OrbitControls.js'] } } } },
});
