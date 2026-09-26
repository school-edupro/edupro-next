/** Shared ESLint (flat config fragments) for EduPro Next. */
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin, import: importPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/no-relative-packages': 'error',
      // Legacy tree must never be referenced (ADR-008).
      'no-restricted-imports': [
        'error',
        { patterns: ['**/schoolerpalpha/**', '**/FTP/**'] },
      ],
      // Business rules never live in Next.js route handlers (ADR-007): forbid database drivers there.
      'no-restricted-modules': 'off',
    },
  },
  {
    files: ['apps/*/app/**/*.ts', 'apps/*/app/**/*.tsx', 'apps/*/middleware.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'Next.js apps never talk to PostgreSQL (ADR-007).' },
            { name: '@prisma/client', message: 'Next.js apps never talk to PostgreSQL (ADR-007).' },
            { name: '@edupro/db', message: 'Next.js apps never talk to PostgreSQL (ADR-007).' },
          ],
          patterns: ['**/schoolerpalpha/**', '**/FTP/**'],
        },
      ],
    },
  },
  prettier,
];
