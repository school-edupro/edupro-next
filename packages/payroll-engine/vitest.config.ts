import { defineConfig } from 'vitest/config';

// Payroll calculations are covered to 100 % (the project plan's quality bar for money paths).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
