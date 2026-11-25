#!/usr/bin/env node
/**
 * The database map for reports (docs/data/README.md): reads the live database's STRUCTURE only — tables, columns,
 * keys, relations, enums, the marts; never a row — and writes
 *   docs/data/schema.json            every table: its module, columns, keys and relations (for a report builder / AI)
 *   docs/data/schema/<module>.md     the same per module, to read
 * Run after migrations, from the repo root with the .env loaded:
 *   node scripts/schema/schema-map.mjs            (uses DATABASE_MIGRATOR_URL, else DATABASE_URL)
 *   node scripts/schema/schema-map.mjs --check    exits 1 when a table has no module (add a rule to MODULES)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'packages', 'db', 'package.json'));
const pg = require('pg');

/** Module of a table: the first rule whose pattern matches its name. Keep in step with docs/data/modules/*.md. */
export const MODULES = [
  ['payroll', /^payroll_/],
  ['library', /^library_/],
  ['hostel', /^(hostel_|hostels$|mess_|fee_hostel_)/],
  [
    'admissions',
    /^(admission_|applicant|application_(?!stage_results$)|applications$|public_otps$)/,
  ],
  [
    'purchase_stores_assets',
    /^(purchase_|vendor|stock_|store|item_store|goods_receipt|asset|condemnation|disposals$)/,
  ],
  // Help for staff (0422) sits with the families' Help
  ['comms_engagement', /^staff_help_/],
  ['staff_leave_attendance', /^staff_/],
  [
    'hr_employees',
    /^(employee|departments$|designations$|acr_|recruitment_|vacancies$|vacancy_|candidate|job_application|application_stage_results$|exit_clearance|postings$|teacher_assignments$)/,
  ],
  ['certificates', /^(certificate|document_template|transfer_certificates$|tc_sequences$)/],
  [
    'exams_results',
    /^(exam|mark_|grade_|indicator|remark|report_card|term_results$|hpc_|portfolio_items$|board_|student_subject|class_stream|subject_groups$|class_subject_parts$)/,
  ],
  [
    'fees_payments',
    /^(fee_|payment|misc_|bank_statement|student_fee|receipt_sequences$|shadow_|school_bank_accounts$|financial_years$)/,
  ],
  ['transport', /^(transport_|bus_|vehicle_positions$|student_route|student_transport$|rfid_)/],
  [
    'attendance_leave_students',
    /^(attendance_|student_attendance_rules$|student_leave|leave_|punch_logs$)/,
  ],
  [
    'academics',
    /^(class|subjects$|timetable_|daily_work|lesson_|syllabus_|almanac|holidays$|academic_|school_directory$|promotion_decisions$|activity_)/,
  ],
  [
    'people_students',
    /^(students$|guardians$|student_|enrolments$|person_documents$|profile_|school_transfers$|withdrawal|family_app)/,
  ],
  [
    'comms_engagement',
    /^(comms_|message_|notice|gallery|consent|privacy|parent_queries$|query_|helpdesk|feedback|appointment|visitor|gate_pass|cctv|clinic|health_|family_help|file_note|push_devices$|birthday|provider_issues$)/,
  ],
  [
    'ai_insights_reports',
    /^(ai_|insight|report_|mis_|exports$|assistant_settings$|dashboard|user_dashboards$|imports$|master_imports$)/,
  ],
  [
    'platform_core',
    /^(schools$|school_groups$|school_settings$|campuses$|users$|user_|roles$|role_permissions$|permissions$|sod_rules$|delegations$|files$|jobs_outbox$|audit_|login_events$|impersonation|break_glass|workflow_|banks$|countries$|states$|cities$|cutover_|hypercare_|data_subject|breach_log$|retention_runs$|service_keys$|portal_handoffs$|web_hops$|mobile_|auth_|api_idempotency$)/,
  ],
];

export const moduleOf = (table) => MODULES.find(([, rx]) => rx.test(table))?.[0] ?? null;

const arr = (x) =>
  Array.isArray(x)
    ? x
    : String(x ?? '')
        .replace(/^\{|\}$/g, '')
        .split(',')
        .filter(Boolean)
        .map((v) => v.replace(/^"|"$/g, ''));

const c = new pg.Client({
  connectionString: process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL,
});
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const tables = await q(`
  SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.relforcerowsecurity AS force_rls,
         c.relrowsecurity AS rls, obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'mart', 'nlq') AND c.relkind IN ('r', 'p', 'v') AND NOT c.relispartition
   ORDER BY 1, 2`);
const columns = await q(`
  SELECT n.nspname AS schema, c.relname AS table, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS not_null, col_description(c.oid, a.attnum) AS comment
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'mart', 'nlq') AND c.relkind IN ('r', 'p', 'v') AND NOT c.relispartition
     AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY 1, 2, a.attnum`);
const keys = await q(`
  SELECT c.relname AS table, k.contype AS type, f.relname AS ref_table,
         ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(n, i) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.i)::text[] AS cols,
         ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(n, i) JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY u.i)::text[] AS ref_cols
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class f ON f.oid = k.confrelid
   WHERE n.nspname = 'public' AND k.contype IN ('p', 'f', 'u') AND NOT c.relispartition
   ORDER BY 1, 2`);
const enums = await q(`
  SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' GROUP BY 1 ORDER BY 1`);
const migration = (await q(`SELECT max(name) AS name FROM app.schema_migrations`))[0]?.name ?? null;
await c.end();

const out = {};
const missing = [];
for (const t of tables) {
  const full = t.schema === 'public' ? t.name : `${t.schema}.${t.name}`;
  const module = t.schema === 'mart' ? 'marts' : t.schema === 'nlq' ? 'nlq' : moduleOf(t.name);
  if (!module) missing.push(full);
  const mine = keys.filter((k) => t.schema === 'public' && k.table === t.name);
  out[full] = {
    module: module ?? 'unassigned',
    kind: t.kind === 'v' ? 'view' : 'table',
    rls: t.force_rls ? 'forced' : t.rls ? 'on' : 'off',
    comment: t.comment ?? undefined,
    columns: columns
      .filter((x) => x.schema === t.schema && x.table === t.name)
      .map((x) => ({
        name: x.name,
        type: x.type,
        ...(x.not_null ? { notNull: true } : {}),
        ...(x.comment ? { comment: x.comment } : {}),
      })),
    primaryKey: arr(mine.find((k) => k.type === 'p')?.cols),
    unique: mine.filter((k) => k.type === 'u').map((k) => arr(k.cols)),
    references: mine
      .filter((k) => k.type === 'f' && k.ref_table !== 'schools')
      .map((k) => ({ columns: arr(k.cols), table: k.ref_table, refColumns: arr(k.ref_cols) })),
    referencedBy: keys
      .filter((k) => k.type === 'f' && k.ref_table === t.name && t.schema === 'public')
      .map((k) => `${k.table}(${arr(k.cols).join(',')})`)
      .filter((v, i, all) => all.indexOf(v) === i),
  };
}

if (process.argv.includes('--check')) {
  if (missing.length) {
    console.error(`schema-map: no module for ${missing.join(', ')} — add a rule to MODULES`);
    process.exit(1);
  }
  console.log(`schema-map: all ${Object.keys(out).length} tables have a module`);
  process.exit(0);
}

const dir = join(root, 'docs', 'data');
mkdirSync(join(dir, 'schema'), { recursive: true });
// the pages are rewritten whole: a module that no longer exists leaves no page behind
for (const f of readdirSync(join(dir, 'schema')))
  if (f.endsWith('.md')) rmSync(join(dir, 'schema', f));
writeFileSync(
  join(dir, 'schema.json'),
  `${JSON.stringify(
    {
      generated: 'scripts/schema/schema-map.mjs — structure only',
      migration,
      enums: Object.fromEntries(enums.map((e) => [e.name, arr(e.labels)])),
      tables: out,
    },
    null,
    1,
  )}\n`,
);
const byModule = new Map();
for (const [name, t] of Object.entries(out)) {
  if (!byModule.has(t.module)) byModule.set(t.module, []);
  byModule.get(t.module).push([name, t]);
}
for (const [module, list] of byModule) {
  const lines = [
    `# ${module} — tables and columns`,
    '',
    `> Generated by \`scripts/schema/schema-map.mjs\` from the live structure (to ${migration ?? '?'}); do not edit by hand.`,
    `> The guide to these tables — meaning, joins, statuses, report examples — is \`docs/data/modules/${module}.md\`.`,
    `> Every table has \`school_id\` (row-level security per school) unless noted; foreign keys to \`schools\` are left out.`,
    '',
  ];
  for (const [name, t] of list) {
    lines.push(`## ${name}`, '');
    if (t.comment) lines.push(t.comment, '');
    lines.push(
      `Primary key: ${t.primaryKey.join(', ') || '—'}${t.unique.length ? ` · unique: ${t.unique.map((u) => `(${u.join(', ')})`).join(', ')}` : ''}${t.rls === 'forced' ? '' : ` · row-level security: ${t.rls}`}`,
      '',
      '| Column | Type | Note |',
      '| --- | --- | --- |',
    );
    for (const col of t.columns) {
      const ref = t.references.find((r) => r.columns.length === 1 && r.columns[0] === col.name);
      const note = [
        col.notNull ? 'required' : '',
        ref ? `→ ${ref.table}.${ref.refColumns[0]}` : '',
        col.comment ? col.comment.replace(/\|/g, '/').replace(/\n/g, ' ') : '',
      ]
        .filter(Boolean)
        .join('; ');
      lines.push(`| ${col.name} | ${col.type} | ${note} |`);
    }
    const multi = t.references.filter((r) => r.columns.length > 1);
    for (const r of multi)
      lines.push(
        '',
        `References (${r.columns.join(', ')}) → ${r.table}(${r.refColumns.join(', ')})`,
      );
    if (t.referencedBy.length) lines.push('', `Referenced by: ${t.referencedBy.join(', ')}`);
    lines.push('');
  }
  writeFileSync(join(dir, 'schema', `${module}.md`), `${lines.join('\n')}\n`);
}
console.log(
  `schema-map: ${Object.keys(out).length} tables in ${byModule.size} modules (to ${migration ?? '?'})${missing.length ? `; no module: ${missing.join(', ')}` : ''}`,
);
