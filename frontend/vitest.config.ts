import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Tests live in tests/, mirroring src/ so a test's path names the module it
    // covers. Nothing matches under src/ on purpose: a test added there would be
    // silently never run, which is the failure mode a colocated layout invites.
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only the shipped code, so coverage reports the product rather than the
      // suite.
      include: ['src/**/*.{ts,tsx}'],
    },
  },
});
