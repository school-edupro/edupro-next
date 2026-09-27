// node --test scripts/schema-diff.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f) => path.join(here, 'fixtures', 'schema-diff', f);

test('schema-diff produces the report from the template with every drift class', () => {
  const out = execFileSync(
    process.execPath,
    [
      path.join(here, 'schema-diff.mjs'),
      '--ref',
      fx('reference.sql'),
      '--cmp',
      fx('compared.sql'),
      '--ref-name',
      'ALPHA',
      '--cmp-name',
      'BETA',
    ],
    {
      encoding: 'utf8',
    },
  );
  assert.match(out, /\| Reference school \| ALPHA \|/);
  assert.match(out, /\| Tables in reference \| 3 \|/);
  assert.match(out, /\| Tables in compared \| 3 \|/);
  assert.match(out, /\| Tables only in reference \| 1 \|/);
  assert.match(out, /\| Tables only in compared \| 1 \|/);
  assert.match(out, /\| Dump dates \| 2026-09-20 10:00:00 \/ 2026-09-21 09:30:00 \|/);
  // width change, type class change, missing column
  assert.match(
    out,
    /\| class_master \| ClassName \| varchar\(50\) \| varchar\(100\) \| NOT NULL \| - \| width or precision differs/,
  );
  assert.match(
    out,
    /\| class_master \| Status \| tinyint\(1\) \| varchar\(10\) \| NOT NULL \| '1' \/ 'Active' \| type class differs/,
  );
  assert.match(
    out,
    /\| class_master \| isTrash \| tinyint\(1\) \| missing \| NULL \/ - \| '0' \/ - \| known drift/,
  );
  // tables only in one school with approximate row counts
  assert.match(out, /\| library_langugage_master \| ALPHA \| 3 \|/);
  assert.match(out, /\| transport_route_extra \| BETA \| n\/a \(no data in dump\) \|/);
  // storage drift
  assert.match(out, /\| class_master \| charset\/collation \| utf8 {2}\| utf8mb4 {2}\|/);
  assert.match(
    out,
    /\| class_master \| index idx_year \| KEY `idx_year` \(`FinancialYear`\) \| missing \|/,
  );
  // identical table produces no rows
  assert.doesNotMatch(out, /\| fee_receipt \|/);
  assert.match(out, /## Sign-off/);
});

test('schema-diff exits with usage when a dump is missing', () => {
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [path.join(here, 'schema-diff.mjs'), '--ref', fx('reference.sql')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
});
