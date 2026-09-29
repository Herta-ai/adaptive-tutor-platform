import { defineConfig } from 'vitest/config';
const ci = !!process.env.CI;
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // SQLite integration tests perform durable writes. Bound disk contention on
    // hosted runners and allow both fixtures and tests time for slower Windows IO.
    maxWorkers: ci ? 2 : undefined,
    testTimeout: ci ? 60000 : 15000,
    hookTimeout: ci ? 60000 : 10000,
  },
});
