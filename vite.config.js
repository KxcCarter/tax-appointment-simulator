import { defineConfig } from 'vite';

export default defineConfig({
  // Rapier's compat build inlines its WASM, so the bundle is large by design.
  build: { chunkSizeWarningLimit: 6000 },
});
