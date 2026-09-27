import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATASETS } from '@edupro/db';
import { createStorageDriver } from '@edupro/storage';
import { exportProcessor } from '../src/processors/exports';
import { toCsv, toXlsx } from '../src/processors/generators';
import { NoPdfEngine, PlaywrightPdfEngine } from '../src/processors/pdf';
import {
  log,
  newDb,
  seedSchool,
  stamp,
  tenantOf,
  withMigrator,
  type SeededSchool,
} from './helpers';

describe('export generators (S3-03)', () => {
  it('writes 3,000 rows to xlsx well under 30 seconds', async () => {
    const columns = DATASETS.members!.columns;
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      display_name: `Person ${i}`,
      person_type: 'employee',
      mobile: '9999999999',
      email: `p${i}@example.test`,
      status: 'active',
      roles: 'Class Teacher, Subject Teacher',
      last_login_at: new Date(2026, 8, 1 + (i % 28)),
    }));
    const started = Date.now();
    const bytes = await toXlsx('Members', columns, rows, {
      school: 'Alpha',
      generatedAt: new Date(),
    });
    const elapsed = Date.now() - started;
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(elapsed).toBeLessThan(30_000);
    const csv = toCsv(columns, rows.slice(0, 2));
    expect(csv.toString('utf8')).toContain('﻿Name,Type,Mobile,Email,Status,Roles,Last sign-in');
    expect(csv.toString('utf8')).toContain('"Class Teacher, Subject Teacher"');
  });
});

describe('export processor (S3-03)', () => {
  const db = newDb();
  let school: SeededSchool;
  let dir: string;

  beforeAll(async () => {
    school = await seedSchool(stamp('WEX'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-exports-'));
    await db.withTenant(tenantOf(school), async (c) => {
      for (let i = 1; i <= 12; i += 1) {
        await c.query(
          'INSERT INTO classes (school_id, code, name, display_order) VALUES (app.current_school_id(), $1, $2, $3)',
          [`C${i}`, `Class ${i}`, i],
        );
      }
    });
  });
  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  const storage = () =>
    createStorageDriver({
      driver: 'local',
      localDir: dir,
      urlTtlSeconds: 60,
      apiBaseUrl: 'http://api',
      signingSecret: 'secret-secret-secret',
    });

  async function requestExport(format: 'xlsx' | 'csv' | 'pdf'): Promise<string> {
    return db.withTenant(tenantOf(school), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by) VALUES (app.current_school_id(), 'classes', $1, '{}'::jsonb, 'Classes', app.current_user_id()) RETURNING id::text`,
        [format],
      );
      return r.rows[0]!.id;
    });
  }
  const envelope = (exportId: string) => ({
    schoolId: school.id,
    userId: school.userId,
    requestId: null,
    kind: 'export.generate',
    payload: { exportId },
  });

  it('generates an xlsx, stores it and registers the file', async () => {
    const exportId = await requestExport('xlsx');
    const driver = storage();
    await exportProcessor({ db, storage: driver, pdf: new NoPdfEngine(), log, ttlDays: 7 })({
      data: envelope(exportId),
      attemptsMade: 0,
      opts: { attempts: 3 },
    });
    const row = await withMigrator((c) =>
      c.query<{
        status: string;
        row_count: number;
        file_id: string;
        object_key: string;
        size_bytes: string;
        owner_entity_id: string;
      }>(
        'SELECT e.status, e.row_count, e.file_id::text, f.object_key, f.size_bytes::text, f.owner_entity_id FROM exports e JOIN files f ON f.id = e.file_id WHERE e.id = $1',
        [exportId],
      ),
    );
    expect(row.rows[0]).toMatchObject({
      status: 'ready',
      row_count: 12,
      owner_entity_id: exportId,
    });
    const head = await driver.head(row.rows[0]!.object_key);
    expect(head?.sizeBytes).toBe(Number(row.rows[0]!.size_bytes));
  });

  it('marks the export failed on the last attempt when the format engine is unavailable', async () => {
    const exportId = await requestExport('pdf');
    const processor = exportProcessor({
      db,
      storage: storage(),
      pdf: new NoPdfEngine(),
      log,
      ttlDays: 7,
    });
    await expect(
      processor({ data: envelope(exportId), attemptsMade: 2, opts: { attempts: 3 } }),
    ).rejects.toThrow(/PDF export is disabled/);
    const row = await withMigrator((c) =>
      c.query('SELECT status, error FROM exports WHERE id = $1', [exportId]),
    );
    expect(row.rows[0]).toMatchObject({ status: 'failed' });
    expect(row.rows[0].error).toMatch(/disabled/);
  });

  it('renders a PDF through Chromium when the browser is installed', async (ctx) => {
    const engine = new PlaywrightPdfEngine();
    try {
      const bytes = await engine.render('<h1>EduPro</h1>');
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
      const exportId = await requestExport('pdf');
      await exportProcessor({ db, storage: storage(), pdf: engine, log, ttlDays: 7 })({
        data: envelope(exportId),
        attemptsMade: 0,
        opts: { attempts: 3 },
      });
      const row = await withMigrator((c) =>
        c.query('SELECT status, row_count FROM exports WHERE id = $1', [exportId]),
      );
      expect(row.rows[0]).toMatchObject({ status: 'ready', row_count: 12 });
    } catch (error) {
      if (
        error instanceof Error &&
        /Executable doesn't exist|browserType.launch/.test(error.message)
      )
        ctx.skip();
      else throw error;
    } finally {
      await engine.close();
    }
  }, 60_000);
});
