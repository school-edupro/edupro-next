#!/usr/bin/env node
/**
 * S2-13: per-school schema diff. Reads two MySQL dumps (mysqldump, with or without data), extracts every
 * CREATE TABLE statement, and prints the Markdown report described in docs/data/04-schema-diff-template.md.
 *
 *   node scripts/schema-diff.mjs --ref <reference.sql> --cmp <compared.sql> [--ref-name X] [--cmp-name Y]
 *                                [--legacy-root <dir>] [--out report.md]
 *
 * Streaming line reader, so a multi-gigabyte dump with data is fine; INSERT statements are only counted
 * (approximate row counts), never parsed. `--legacy-root` greps the legacy PHP tree for each table name that
 * exists in one school only; the tree is read at run time and never imported (ADR-008).
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = parseArgs(process.argv.slice(2));
if (!args.ref || !args.cmp) {
  console.error(
    'usage: schema-diff.mjs --ref <reference.sql> --cmp <compared.sql> [--ref-name X] [--cmp-name Y] [--legacy-root <dir>] [--out report.md]',
  );
  process.exit(2);
}

const ref = await readDump(args.ref);
const cmp = await readDump(args.cmp);
const report = renderReport(ref, cmp, {
  refName: args['ref-name'] ?? args.ref,
  cmpName: args['cmp-name'] ?? args.cmp,
  legacyRoot: args['legacy-root'],
});
if (args.out) {
  writeFileSync(args.out, report);
  console.error(`report written to ${args.out}`);
} else {
  process.stdout.write(report);
}

// ---- parsing -------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else out[key] = true;
    }
  }
  return out;
}

/** @returns {Promise<{tables: Map<string, Table>, dumpDate: string|null}>} */
export async function readDump(file) {
  const tables = new Map();
  let dumpDate = null;
  let current = null; // { name, lines }
  let inserts = new Map();
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    const line = raw.replace(/\r$/, '');
    if (dumpDate === null) {
      const m =
        /^-- Dump completed on (.+)$/.exec(line) ||
        /^-- Server version\s+(.+)$/.exec(line) ||
        /^-- Host: .* Database: (.+)$/.exec(line);
      if (/^-- Dump completed on/.test(line)) dumpDate = m[1].trim();
    }
    if (current) {
      current.lines.push(line);
      if (/^\)\s*(ENGINE|TYPE)?=?.*;\s*$/.test(line) || /^\)\s*;\s*$/.test(line)) {
        tables.set(current.name, parseCreateTable(current.name, current.lines));
        current = null;
      }
      continue;
    }
    const create = /^CREATE TABLE (?:IF NOT EXISTS )?`?([A-Za-z0-9_$]+)`?\s*\(/.exec(line);
    if (create) {
      current = { name: create[1], lines: [line] };
      if (
        /\)\s*(ENGINE|TYPE)?=?.*;\s*$/.test(line) &&
        line.indexOf('(') !== line.lastIndexOf(')')
      ) {
        // single-line CREATE TABLE
        tables.set(current.name, parseCreateTable(current.name, [line]));
        current = null;
      }
      continue;
    }
    const insert = /^INSERT INTO `?([A-Za-z0-9_$]+)`?/.exec(line);
    if (insert) {
      // approximate: one tuple per "),(" plus one
      const tuples = (line.match(/\),\(/g) || []).length + 1;
      inserts.set(insert[1], (inserts.get(insert[1]) ?? 0) + tuples);
    }
  }
  for (const [name, n] of inserts) if (tables.has(name)) tables.get(name).rows = n;
  return { tables, dumpDate, file };
}

/**
 * @typedef {{ name: string, type: string, nullable: boolean, defaultValue: string|null, extra: string, comment: string|null }} Column
 * @typedef {{ name: string, columns: Map<string, Column>, keys: Map<string, string>, engine: string|null, charset: string|null, collation: string|null, rows: number|null }} Table
 */
export function parseCreateTable(name, lines) {
  /** @type {Table} */
  const t = {
    name,
    columns: new Map(),
    keys: new Map(),
    engine: null,
    charset: null,
    collation: null,
    rows: null,
  };
  const body = lines.slice(1, -1);
  const last = lines[lines.length - 1];
  const engine = /ENGINE=([A-Za-z0-9_]+)/.exec(last);
  const charset = /(?:DEFAULT )?CHARSET=([A-Za-z0-9_]+)/.exec(last);
  const collation = /COLLATE=([A-Za-z0-9_]+)/.exec(last);
  t.engine = engine ? engine[1] : null;
  t.charset = charset ? charset[1] : null;
  t.collation = collation ? collation[1] : null;
  for (const raw of body) {
    const line = raw.trim().replace(/,$/, '');
    if (!line) continue;
    const key =
      /^(PRIMARY KEY|UNIQUE KEY|UNIQUE|KEY|INDEX|FULLTEXT KEY|SPATIAL KEY|CONSTRAINT)\s*`?([A-Za-z0-9_$]*)`?\s*(.*)$/.exec(
        line,
      );
    if (key) {
      const keyName = key[1] === 'PRIMARY KEY' ? 'PRIMARY' : key[2] || key[3];
      t.keys.set(keyName, line.replace(/\s+/g, ' '));
      continue;
    }
    const col = /^`([^`]+)`\s+(.+)$/.exec(line);
    if (!col) continue;
    const rest = col[2];
    const typeMatch = /^([a-zA-Z]+(?:\([^)]*\))?(?:\s+unsigned)?(?:\s+zerofill)?)/i.exec(rest);
    const type = typeMatch
      ? typeMatch[1].toLowerCase().replace(/\s+/g, ' ')
      : rest.split(' ')[0].toLowerCase();
    const nullable = !/\bNOT NULL\b/i.test(rest);
    const def = /\bDEFAULT\s+((?:'[^']*')|(?:"[^"]*")|(?:[A-Za-z0-9_().:-]+))/i.exec(rest);
    const comment = /\bCOMMENT\s+'((?:[^']|'')*)'/i.exec(rest);
    const extra = [
      /\bAUTO_INCREMENT\b/i.test(rest) ? 'auto_increment' : null,
      /\bON UPDATE CURRENT_TIMESTAMP\b/i.test(rest) ? 'on update current_timestamp' : null,
    ]
      .filter(Boolean)
      .join(' ');
    t.columns.set(col[1], {
      name: col[1],
      type,
      nullable,
      defaultValue: def ? def[1] : null,
      extra,
      comment: comment ? comment[1] : null,
    });
  }
  return t;
}

// ---- report --------------------------------------------------------------------------------------
export function renderReport(ref, cmp, opts) {
  const refNames = new Set(ref.tables.keys());
  const cmpNames = new Set(cmp.tables.keys());
  const onlyRef = [...refNames].filter((n) => !cmpNames.has(n)).sort();
  const onlyCmp = [...cmpNames].filter((n) => !refNames.has(n)).sort();
  const shared = [...refNames].filter((n) => cmpNames.has(n)).sort();

  const lines = [];
  lines.push(`# Per-school schema diff report: ${opts.refName} vs ${opts.cmpName}`, '');
  lines.push('## Header', '', '| | |', '|---|---|');
  lines.push(`| Reference school | ${opts.refName} |`);
  lines.push(`| Compared school | ${opts.cmpName} |`);
  lines.push(`| Dump dates | ${ref.dumpDate ?? 'unknown'} / ${cmp.dumpDate ?? 'unknown'} |`);
  lines.push(`| Tables in reference | ${refNames.size} |`);
  lines.push(`| Tables in compared | ${cmpNames.size} |`);
  lines.push(`| Tables only in reference | ${onlyRef.length} |`);
  lines.push(`| Tables only in compared | ${onlyCmp.length} |`);
  lines.push(
    `| Generated | ${new Date().toISOString().slice(0, 10)} by scripts/schema-diff.sh |`,
    '',
  );

  lines.push('## Column differences (tables present in both)', '');
  lines.push(
    '| Table | Column | Reference type | Compared type | Nullability | Default | Impact on ETL |',
    '|---|---|---|---|---|---|---|',
  );
  let colDiffs = 0;
  for (const name of shared) {
    const a = ref.tables.get(name);
    const b = cmp.tables.get(name);
    const cols = new Set([...a.columns.keys(), ...b.columns.keys()]);
    for (const c of cols) {
      const ca = a.columns.get(c);
      const cb = b.columns.get(c);
      if (!ca || !cb) {
        colDiffs += 1;
        lines.push(
          `| ${name} | ${c} | ${ca ? ca.type : 'missing'} | ${cb ? cb.type : 'missing'} | ${nullability(ca, cb)} | ${defaults(ca, cb)} | ${impactMissing(c, ca ? 'compared' : 'reference')} |`,
        );
        continue;
      }
      if (
        ca.type !== cb.type ||
        ca.nullable !== cb.nullable ||
        (ca.defaultValue ?? '') !== (cb.defaultValue ?? '')
      ) {
        colDiffs += 1;
        lines.push(
          `| ${name} | ${c} | ${ca.type} | ${cb.type} | ${nullability(ca, cb)} | ${defaults(ca, cb)} | ${impactType(ca, cb)} |`,
        );
      }
    }
  }
  if (colDiffs === 0) lines.push('| (none) | | | | | | |');
  lines.push('');

  lines.push('## Tables only in one school', '');
  lines.push(
    '| Table | School | Rows | Used by legacy code (yes/no, file) | Decision (migrate, archive, drop) |',
    '|---|---|---|---|---|',
  );
  const used = (table) => legacyUsage(table, opts.legacyRoot);
  for (const n of onlyRef)
    lines.push(`| ${n} | ${opts.refName} | ${rows(ref.tables.get(n))} | ${used(n)} | |`);
  for (const n of onlyCmp)
    lines.push(`| ${n} | ${opts.cmpName} | ${rows(cmp.tables.get(n))} | ${used(n)} | |`);
  if (onlyRef.length + onlyCmp.length === 0) lines.push('| (none) | | | | |');
  lines.push('');

  lines.push('## Index and storage differences (tables present in both)', '');
  lines.push('| Table | Kind | Reference | Compared |', '|---|---|---|---|');
  let storageDiffs = 0;
  for (const name of shared) {
    const a = ref.tables.get(name);
    const b = cmp.tables.get(name);
    if ((a.charset ?? '') !== (b.charset ?? '') || (a.collation ?? '') !== (b.collation ?? '')) {
      storageDiffs += 1;
      lines.push(
        `| ${name} | charset/collation | ${a.charset ?? '-'} ${a.collation ?? ''} | ${b.charset ?? '-'} ${b.collation ?? ''} |`,
      );
    }
    if ((a.engine ?? '') !== (b.engine ?? '')) {
      storageDiffs += 1;
      lines.push(`| ${name} | engine | ${a.engine ?? '-'} | ${b.engine ?? '-'} |`);
    }
    const keys = new Set([...a.keys.keys(), ...b.keys.keys()]);
    for (const k of keys) {
      const ka = a.keys.get(k);
      const kb = b.keys.get(k);
      if (ka !== kb) {
        storageDiffs += 1;
        lines.push(`| ${name} | index ${k} | ${ka ?? 'missing'} | ${kb ?? 'missing'} |`);
      }
    }
  }
  if (storageDiffs === 0) lines.push('| (none) | | | |');
  lines.push('');

  lines.push('## Known drift to expect (from the blueprint)', '');
  lines.push(
    '- `FinancialYear`, `isTrash`, `Status` columns added by scripts at different times; some schools lack them on some tables.',
  );
  lines.push("- `Status` stored as `TINYINT` in some schools and `VARCHAR('Active')` in others.");
  lines.push(
    '- `EANDE_*` per-campus exam copies may reference extra tables (`reportcard_*` variants).',
  );
  lines.push('- Character sets differ (`utf8` vs `utf8mb4`) and collations vary per table.');
  lines.push(
    '- Typo tables (`library_langugage_master`, `inventroy_master`) exist in some schools only.',
    '',
  );
  lines.push(
    '## Sign-off',
    '',
    '| Role | Name | Date |',
    '|---|---|---|',
    '| Data engineer | | |',
    '| Architect | | |',
    '',
  );
  return lines.join('\n');
}

function nullability(a, b) {
  const f = (c) => (c ? (c.nullable ? 'NULL' : 'NOT NULL') : '-');
  return f(a) === f(b) ? f(a) : `${f(a)} / ${f(b)}`;
}
function defaults(a, b) {
  const f = (c) => (c && c.defaultValue !== null ? c.defaultValue : '-');
  return f(a) === f(b) ? f(a) : `${f(a)} / ${f(b)}`;
}
function rows(t) {
  return t && t.rows !== null ? String(t.rows) : 'n/a (no data in dump)';
}
function impactMissing(column, missingIn) {
  if (/^(FinancialYear|isTrash|Status|status|is_trash)$/i.test(column))
    return `known drift: column absent in ${missingIn}; transform defaults it`;
  return `column absent in ${missingIn}: transform must default or drop it`;
}
function impactType(a, b) {
  const numeric = /int|decimal|float|double|numeric/;
  const text = /char|text|enum|set/;
  if ((numeric.test(a.type) && text.test(b.type)) || (text.test(a.type) && numeric.test(b.type)))
    return 'type class differs: normalise in transform (see type mapping catalogue)';
  if (a.type !== b.type) return 'width or precision differs: target takes the wider type';
  if (a.nullable !== b.nullable)
    return 'nullability differs: target column nullable, reject rule per module';
  return 'default differs: ETL sets explicit values, no impact';
}
function legacyUsage(table, root) {
  if (!root) return '';
  try {
    const out = execFileSync('grep', ['-rlI', '-m1', '-w', '--include=*.php', table, root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.split('\n').filter(Boolean)[0];
    return first ? `yes, ${first.replace(root, '').replace(/^\//, '')}` : 'no';
  } catch {
    return 'no';
  }
}
