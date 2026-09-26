/** End-to-end tests: need DATABASE_URL, DATABASE_MIGRATOR_URL and migrations applied. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/.*\\.(e2e-spec|spec)\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
