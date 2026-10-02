import { defineConfig } from 'vitest/config';
// 교차 출처 격리(COOP/COEP)를 켜면 브라우저 performance.now() 해상도가 0.1ms → 수 µs로 좋아진다(측정용).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { include: ['tests/unit/**/*.test.ts'] },
  build: {
    chunkSizeWarningLimit: 4600, // Rapier compat 패키지는 WASM을 base64로 내장한다(2D 3.4MB, 3D 4.3MB)
    rollupOptions: { output: { manualChunks: { renderer: ['three'], rapier2d: ['@dimforge/rapier2d-compat'], rapier3d: ['@dimforge/rapier3d-compat'] } } },
  },
});
