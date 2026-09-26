import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Tests live in tests/, mirroring src/ so a test's path names the module it
    // covers. Nothing matches under src/ on purpose: a test added there would be
    // silently never run, which is the failure mode a colocated layout invites.
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only the shipped code. With tests outside src/ the default would sweep
      // them in and report on the suite rather than on the product.
      include: ['src/**/*.ts'],
    },
  },
});
