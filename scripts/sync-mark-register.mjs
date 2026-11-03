#!/usr/bin/env node
// Copies the mark register engine (packages/db/src/mark-register.ts, no imports) to the UI package, so
// the register builder's preview runs the same rules as the API (docs/design/68).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'packages/db/src/mark-register.ts'), 'utf8');
const banner =
  '// GENERATED from packages/db/src/mark-register.ts by scripts/sync-mark-register.mjs — do not edit.\n';
writeFileSync(join(root, 'packages/ui/src/mark-register.ts'), banner + src);
console.log('mark register engine copied to packages/ui/src/mark-register.ts');
// the grade registers' engine too (docs/design/69): the builder's preview
const grade = readFileSync(join(root, 'packages/db/src/grade-register.ts'), 'utf8');
writeFileSync(
  join(root, 'packages/ui/src/grade-register.ts'),
  '// GENERATED from packages/db/src/grade-register.ts by scripts/sync-mark-register.mjs — do not edit.\n' +
    grade,
);
console.log('grade register engine copied to packages/ui/src/grade-register.ts');
