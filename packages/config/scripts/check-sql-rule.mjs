// Verifies the S2-12 rule: the bad fixture is reported at every statement, the good fixture is clean.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const rule = require('../rules/sql-template-literal.cjs');
const tsParser = require('@typescript-eslint/parser');

const eslint = new ESLint({
  cwd: path.resolve(here, '..'),
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['fixtures/**/*.ts'],
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
      rules: {
        'no-restricted-syntax': ['error', { selector: rule.selector, message: rule.message }],
      },
    },
  ],
});

const results = await eslint.lintFiles([
  'fixtures/sql-template-literal.bad.ts',
  'fixtures/sql-template-literal.good.ts',
]);
let failed = false;
for (const r of results) {
  const errors = r.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  const isBad = r.filePath.endsWith('.bad.ts');
  const expected = isBad ? 4 : 0;
  const ok = errors.length === expected;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${path.basename(r.filePath)}: ${errors.length} report(s), expected ${expected}`,
  );
  for (const m of errors) console.log(`       line ${m.line}: ${m.message.slice(0, 80)}...`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
