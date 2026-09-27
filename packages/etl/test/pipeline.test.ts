import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  MemoryLegacyMap,
  MemorySource,
  normaliseCode,
  normaliseStatus,
  reject,
  runStep,
  type Loader,
  type Step,
} from '../src';

interface RawStudent extends Record<string, unknown> {
  srno: number;
  sadmission: string;
  sname: string;
  status: string;
  FinancialYear: string;
}

interface StudentRow {
  admissionNo: string;
  name: string;
  status: 'active' | 'inactive';
}

/** Fake pg client recording the SQL the runner issues (bookkeeping and legacy_map). */
function fakeClient(log: string[]): PoolClient {
  let runCounter = 0;
  return {
    query: async (sql: string) => {
      log.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40));
      if (sql.includes('INSERT INTO etl.runs')) {
        runCounter += 1;
        return { rows: [{ id: String(runCounter) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
}

describe('runStep', () => {
  const step: Step<RawStudent, StudentRow> = {
    legacyTable: 'student_master',
    transform(raw) {
      const code = normaliseCode(raw.sadmission);
      const status = normaliseStatus(raw.status);
      const rejects = [];
      if (code.kind === 'reject')
        rejects.push({ ...code, column: 'sadmission', legacyKey: `srno=${raw.srno}` });
      if (status.kind === 'reject')
        rejects.push({ ...status, column: 'status', legacyKey: `srno=${raw.srno}` });
      if (rejects.length > 0 || code.kind === 'reject' || status.kind === 'reject') return rejects;
      return {
        row: {
          admissionNo: code.value,
          name: String(raw.sname).trim(),
          status: status.value ?? 'active',
        },
        legacyKey: `sadmission=${code.value}`,
        legacyYear: raw.FinancialYear,
      };
    },
  };

  it('loads good rows, records rejects, keeps counts and identity map entries', async () => {
    const source = new MemorySource<RawStudent>({
      student_master: [
        { srno: 1, sadmission: 'r1', sname: 'A', status: 'Active', FinancialYear: '2025' },
        { srno: 2, sadmission: '', sname: 'B', status: 'Active', FinancialYear: '2025' },
        { srno: 3, sadmission: 'r3', sname: 'C', status: 'Approved', FinancialYear: '2025' },
        { srno: 4, sadmission: 'r4', sname: 'D', status: '1', FinancialYear: '2024' },
      ],
    });
    const loaded: StudentRow[] = [];
    const map = new MemoryLegacyMap();
    const loader: Loader<StudentRow> = {
      targetTable: 'students',
      async load(_client, rows) {
        const ids: string[] = [];
        for (const r of rows) {
          loaded.push(r.row);
          const id = String(100 + loaded.length);
          await map.set(
            { table: 'student_master', key: r.legacyKey, year: r.legacyYear },
            'students',
            id,
          );
          ids.push(id);
        }
        return ids;
      },
    };
    const log: string[] = [];
    const client = fakeClient(log);

    const report = await runStep(
      source,
      step,
      loader,
      {
        schoolId: '9',
        domain: 'people',
        sourceLabel: 'fixture',
        batchSize: 2,
        withTenant: (fn) => fn(client),
        withBookkeeping: (fn) => fn(client),
      },
      '2025',
    );

    expect(report).toMatchObject({ extracted: 3, loaded: 1, rejected: 2, blockingRejects: 1 });
    expect(loaded).toEqual([{ admissionNo: 'R1', name: 'A', status: 'active' }]);
    expect(map.size).toBe(1);
    expect(await map.get({ table: 'student_master', key: 'sadmission=R1', year: '2025' })).toEqual({
      targetTable: 'students',
      targetId: '101',
    });
    expect(log.filter((l) => l.startsWith('INSERT INTO etl.rejects')).length).toBe(2);
    expect(log.some((l) => l.startsWith("UPDATE etl.runs SET status = 'succeeded'"))).toBe(true);
  });

  it('marks the run failed when the loader throws', async () => {
    const source = new MemorySource<RawStudent>({
      student_master: [
        { srno: 1, sadmission: 'r1', sname: 'A', status: 'Active', FinancialYear: '2025' },
      ],
    });
    const loader: Loader<StudentRow> = {
      targetTable: 'students',
      async load() {
        throw new Error('boom');
      },
    };
    const log: string[] = [];
    const client = fakeClient(log);
    await expect(
      runStep(source, step, loader, {
        schoolId: '9',
        domain: 'people',
        sourceLabel: 'fixture',
        withTenant: (fn) => fn(client),
        withBookkeeping: (fn) => fn(client),
      }),
    ).rejects.toThrow('boom');
    expect(log.some((l) => l.startsWith("UPDATE etl.runs SET status = 'failed'"))).toBe(true);
    expect(reject('x', 1).kind).toBe('reject');
  });
});
