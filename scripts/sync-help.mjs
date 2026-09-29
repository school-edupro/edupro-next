#!/usr/bin/env node
/**
 * Copies the training pages (docs/training/*.md) into the admin app's help content folder so the help
 * centre (/help) ships them inside the build. Run after editing a training page:
 *   node scripts/sync-help.mjs
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'docs', 'training');
const to = join(root, 'apps', 'admin', 'content', 'help');
mkdirSync(to, { recursive: true });
let n = 0;
for (const f of readdirSync(from)) {
  if (!f.endsWith('.md')) continue;
  copyFileSync(join(from, f), join(to, f));
  n += 1;
}
console.log(`synced ${n} help page(s) to apps/admin/content/help`);
