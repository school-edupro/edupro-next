#!/usr/bin/env node
// Copies the admission form engine (packages/db/src/admission-engine.ts, no imports) to the UI package,
// so the browser runs the same rules as the API (docs/design/39, part 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'packages/db/src/admission-engine.ts'), 'utf8');
const banner =
  '// GENERATED from packages/db/src/admission-engine.ts by scripts/sync-admission-engine.mjs — do not edit.\n';
writeFileSync(join(root, 'packages/ui/src/admission-engine.ts'), banner + src);
console.log('admission engine copied to packages/ui/src/admission-engine.ts');
