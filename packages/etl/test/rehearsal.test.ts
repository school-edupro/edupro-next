/**
 * ETL rehearsal 2 (dry run, Sprint 11): every transform step runs over a synthetic legacy extract shaped like
 * the pilot's tables (packages/etl/fixtures/rehearsal-2). The test asserts the reject rate per table and
 * prints the reconciliation summary recorded in docs/data/etl-rehearsal-2.md. The real rehearsal needs the
 * production dumps (S0-08), which have not been shared.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Step } from '../src/pipeline';
import {
  attendanceStep,
  employeeNoticeStep,
  feeHeadStep,
  homeworkStep,
  parentQueryStep,
  queryResponseStep,
  rfidLogStep,
  studentRecordStep,
} from '../src';

const fixture = <T>(table: string): T[] =>
  JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'rehearsal-2', `${table}.json`), 'utf8'),
  ) as T[];

interface Summary {
  table: string;
  extracted: number;
  transformed: number;
  rejected: number;
  blocking: number;
  reasons: Record<string, number>;
}

function run<TRaw, TRow>(step: Step<TRaw, TRow>): Summary {
  const rows = fixture<TRaw>(step.legacyTable);
  const summary: Summary = {
    table: step.legacyTable,
    extracted: rows.length,
    transformed: 0,
    rejected: 0,
    blocking: 0,
    reasons: {},
  };
  const keys = new Set<string>();
  for (const raw of rows) {
    const out = step.transform(raw);
    if (Array.isArray(out)) {
      summary.rejected++;
      if (out.some((r) => r.blocking)) summary.blocking++;
      for (const r of out) summary.reasons[r.reason] = (summary.reasons[r.reason] ?? 0) + 1;
    } else {
      summary.transformed++;
      expect(keys.has(out.legacyKey)).toBe(false); // legacy keys stay unique per table
      keys.add(out.legacyKey);
    }
  }
  return summary;
}

describe('ETL rehearsal 2 (dry run on synthetic extract)', () => {
  const steps: Array<Step<unknown, unknown>> = [
    studentRecordStep,
    attendanceStep,
    rfidLogStep,
    employeeNoticeStep,
    homeworkStep,
    parentQueryStep,
    queryResponseStep,
    feeHeadStep,
  ] as unknown as Array<Step<unknown, unknown>>;
  const summaries = steps.map((s) => run(s));

  it('transforms every table with the expected reject rate and explainable reasons', () => {
    console.log(
      `\nRehearsal 2 (dry run):\n${summaries
        .map(
          (s) =>
            `  ${s.table.padEnd(24)} extracted ${String(s.extracted).padStart(5)}  loaded ${String(s.transformed).padStart(5)}  rejected ${String(s.rejected).padStart(4)}  ${Object.entries(
              s.reasons,
            )
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`,
        )
        .join('\n')}\n`,
    );
    for (const s of summaries) {
      expect(s.extracted).toBeGreaterThan(0);
      expect(s.rejected / s.extracted).toBeLessThan(0.15); // the synthetic extract carries known bad rows
      expect(Object.keys(s.reasons).every((r) => /^[a-z_]+\.[a-z_]+$/.test(r))).toBe(true); // every reject has a coded reason
    }
    const attendance = summaries.find((s) => s.table === 'attendance')!;
    expect(
      attendance.reasons['date.unparseable'] ?? attendance.reasons['attendance.date_missing'] ?? 0,
    ).toBeGreaterThan(0); // the bad-date day
    const students = summaries.find((s) => s.table === 'student_master')!;
    expect(students.transformed + students.rejected).toBe(200);
  });

  it('reconciles counts the way the cutover checklist expects', () => {
    const queries = summaries.find((s) => s.table === 'parent_query')!;
    const responses = summaries.find((s) => s.table === 'parent_query_responses')!;
    // every response points at a query that exists in the extract
    const queryIds = new Set(fixture<{ query_id: string }>('parent_query').map((q) => q.query_id));
    const orphans = fixture<{ query_id: string }>('parent_query_responses').filter(
      (r) => !queryIds.has(r.query_id),
    );
    expect(orphans).toHaveLength(0);
    expect(queries.transformed).toBeGreaterThan(70);
    expect(responses.transformed).toBe(60);
  });
});
