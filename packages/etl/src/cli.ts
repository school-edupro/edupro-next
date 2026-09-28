/**
 * Runs one ETL domain for one school.
 *
 *   pnpm --filter @edupro/etl run:domain -- --school 1 --school-code ALPHA --domain tenancy --fixture ./fixtures/alpha.json
 *   pnpm --filter @edupro/etl run:domain -- --school 1 --school-code ALPHA --domain identity --mysql mysql://user:pass@host/db --provisioning out.csv
 *
 * Connects with DATABASE_ETL_URL (falls back to DATABASE_MIGRATOR_URL locally). Every load runs inside a
 * tenant transaction for the school; bookkeeping goes to the etl schema. Prints the run report as JSON.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Client, type PoolClient } from 'pg';
import {
  adminStep,
  employeeStep,
  guardianStep,
  studentStep,
  UsersLoader,
  type PersonRow,
} from './domains/identity';
import {
  EmployeesLoader,
  StudentsLoader,
  employeeRecordStep,
  studentRecordStep,
} from './domains/people';
import { provisioningRows, toProvisioningCsv } from './domains/provisioning';
import { tenancyStep, YearsLoader } from './domains/tenancy';
import { recordMeasures, runStep, type ReconcileMeasure, type Source } from './pipeline';
import { MemorySource } from './sources/memory';
import { MysqlSource } from './sources/mysql';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const schoolId = arg('school');
  const schoolCode = arg('school-code') ?? `S${schoolId}`;
  const domain = arg('domain');
  if (!schoolId || !domain)
    throw new Error(
      'usage: --school <id> --domain tenancy|identity|people [--fixture file.json | --mysql url] [--provisioning out.csv]',
    );

  const url = process.env.DATABASE_ETL_URL ?? process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_ETL_URL or DATABASE_MIGRATOR_URL is required');
  const pg = new Client({ connectionString: url, application_name: 'edupro-etl' });
  await pg.connect();

  const fixture = arg('fixture');
  const mysql = arg('mysql');
  let source: Source<Record<string, unknown>>;
  let close: () => Promise<void> = async () => undefined;
  if (fixture)
    source = new MemorySource(
      JSON.parse(await readFile(fixture, 'utf8')) as Record<string, Array<Record<string, unknown>>>,
    );
  else if (mysql) {
    const s = new MysqlSource({ uri: mysql });
    source = s;
    close = () => s.close();
  } else throw new Error('--fixture or --mysql is required');

  const withTenant = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    await pg.query('BEGIN');
    try {
      await pg.query(
        "SELECT set_config('app.school_id', $1, true), set_config('app.allowed_school_ids', $2, true)",
        [schoolId, `{${schoolId}}`],
      );
      const out = await fn(pg as unknown as PoolClient);
      await pg.query('COMMIT');
      return out;
    } catch (error) {
      await pg.query('ROLLBACK');
      throw error;
    }
  };
  const withBookkeeping = withTenant;
  const opts = {
    schoolId,
    domain,
    sourceLabel: fixture ?? mysql ?? 'unknown',
    withTenant,
    withBookkeeping,
  };

  const reports: unknown[] = [];
  const measures: ReconcileMeasure[] = [];
  const countRows = async (table: string): Promise<number> => {
    let n = 0;
    for await (const row of source.rows(table)) {
      void row;
      n += 1;
    }
    return n;
  };

  if (domain === 'tenancy') {
    const academic = await runStep(source, tenancyStep, new YearsLoader('academic'), opts);
    const financial = await runStep(source, tenancyStep, new YearsLoader('financial'), opts);
    reports.push({ academic, financial });
    const legacy = await countRows('FYmaster');
    const target = await withTenant(async (c) =>
      Number(
        (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM academic_years')).rows[0]!.n,
      ),
    );
    measures.push({ measure: 'years.count', legacyValue: legacy, targetValue: target });
    await withBookkeeping((c) => recordMeasures(c, academic.runId, schoolId, measures));
  } else if (domain === 'identity') {
    const people: PersonRow[] = [];
    const capture = (step: {
      legacyTable: string;
      transform: (raw: Record<string, unknown>) => unknown;
    }) => ({
      legacyTable: step.legacyTable,
      transform(raw: Record<string, unknown>) {
        const out = step.transform(raw) as { row: PersonRow } | unknown[];
        if (!Array.isArray(out)) people.push(out.row);
        return out as never;
      },
    });
    const loader = new UsersLoader();
    const admins = await runStep(source, capture(adminStep(schoolCode)), loader, opts);
    const employees = await runStep(source, capture(employeeStep(schoolCode)), loader, opts);
    const students = await runStep(source, capture(studentStep(schoolCode)), loader, opts);
    const guardians = await runStep(source, capture(guardianStep(schoolCode)), loader, opts);
    reports.push({ admins, employees, students, guardians });
    const memberships = await withTenant(
      async (c) =>
        (
          await c.query<{ person_type: string; n: string }>(
            'SELECT person_type::text, count(*)::text AS n FROM user_school_memberships WHERE deleted_at IS NULL GROUP BY 1',
          )
        ).rows,
    );
    const target = (t: string) => Number(memberships.find((m) => m.person_type === t)?.n ?? 0);
    const distinctEmployees = new Set(
      people.filter((p) => p.personType === 'employee').map((p) => p.oneauthSub),
    ).size;
    measures.push(
      {
        measure: 'memberships.employee',
        legacyValue: distinctEmployees,
        targetValue: target('employee'),
      },
      {
        measure: 'memberships.student',
        legacyValue: new Set(
          people.filter((p) => p.personType === 'student').map((p) => p.oneauthSub),
        ).size,
        targetValue: target('student'),
      },
      {
        measure: 'memberships.guardian',
        legacyValue: new Set(
          people.filter((p) => p.personType === 'guardian').map((p) => p.oneauthSub),
        ).size,
        targetValue: target('guardian'),
      },
    );
    await withBookkeeping((c) => recordMeasures(c, guardians.runId, schoolId, measures));
    const out = arg('provisioning');
    if (out) await writeFile(out, toProvisioningCsv(provisioningRows(people)));
  } else if (domain === 'people') {
    const students = new StudentsLoader();
    const studentRun = await runStep(source, studentRecordStep, students, opts);
    const employeeRun = await runStep(source, employeeRecordStep, new EmployeesLoader(), opts);
    reports.push({
      students: studentRun,
      employees: employeeRun,
      unresolvedSections: Object.fromEntries(students.unresolvedSections),
    });
    // Reconciliation per class and year: legacy rows with a section versus enrolments loaded.
    const legacyPerSection = new Map<string, number>();
    for await (const raw of source.rows('student_master')) {
      const out = studentRecordStep.transform(raw as never);
      if (Array.isArray(out) || !out.row.section?.section || !out.legacyYear) continue;
      const key = `${out.legacyYear}:${out.row.section.classCode}-${out.row.section.section}`;
      legacyPerSection.set(key, (legacyPerSection.get(key) ?? 0) + 1);
    }
    const target = await withTenant(
      async (c) =>
        (
          await c.query<{ key: string; n: string }>(
            `SELECT y.legacy_ref || ':' || c.code || '-' || cs.name AS key, count(*)::text AS n
             FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = e.academic_year_id
            GROUP BY 1`,
          )
        ).rows,
    );
    for (const [key, legacy] of legacyPerSection) {
      measures.push({
        measure: `enrolments.${key}`,
        legacyValue: legacy,
        targetValue: Number(target.find((t) => t.key === key)?.n ?? 0),
      });
    }
    measures.push(
      {
        measure: 'students.count',
        legacyValue: studentRun.extracted - studentRun.rejected,
        targetValue: await withTenant(async (c) =>
          Number(
            (
              await c.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM students WHERE deleted_at IS NULL',
              )
            ).rows[0]!.n,
          ),
        ),
      },
      {
        measure: 'employees.count',
        legacyValue: employeeRun.extracted - employeeRun.rejected,
        targetValue: await withTenant(async (c) =>
          Number(
            (
              await c.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM employees WHERE deleted_at IS NULL',
              )
            ).rows[0]!.n,
          ),
        ),
      },
    );
    await withBookkeeping((c) => recordMeasures(c, employeeRun.runId, schoolId, measures));
  } else {
    throw new Error(`unknown domain ${domain}; tenancy, identity and people are available`);
  }

  console.log(JSON.stringify({ schoolId, domain, reports, measures }, null, 2));
  await close();
  await pg.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
