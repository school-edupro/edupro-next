#!/usr/bin/env node
/**
 * docs/design/102: copies the help centre's pages (apps/admin/content/help/*.md) into the API's build (dist/help), so
 * the assistant can answer "how do I …" from them wherever the API runs. Part of `pnpm --filter @edupro/api build`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(api, '..', 'admin', 'content', 'help');
const to = join(api, 'dist', 'help');
if (!existsSync(from)) {
  console.warn(`copy-help: ${from} not found; the assistant will have no help pages`);
  process.exit(0);
}
mkdirSync(to, { recursive: true });
let n = 0;
for (const f of readdirSync(from)) {
  if (!f.endsWith('.md')) continue;
  copyFileSync(join(from, f), join(to, f));
  n += 1;
}
console.log(`copy-help: ${n} help page(s) to dist/help`);
