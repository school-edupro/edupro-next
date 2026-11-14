import { describe, expect, it } from 'vitest';
import {
  legacyCertUrlFromEnv,
  readLegacyCertificates,
} from '../src/processors/legacy-certificates';
import { log, newDb, seedSchool, stamp, withMigrator } from './helpers';

describe('the old certificate register reader (docs/design/87, phase F)', () => {
  it('takes the connection from the environment, a school’s own first', () => {
    expect(legacyCertUrlFromEnv('AB1', {})).toBeNull();
    expect(legacyCertUrlFromEnv('AB1', { LEGACY_CERT_DB_URL: 'mysql://all' })).toBe('mysql://all');
    expect(
      legacyCertUrlFromEnv('ab-1', {
        LEGACY_CERT_DB_URL: 'mysql://all',
        LEGACY_CERT_DB_URL_AB_1: 'mysql://own',
      }),
    ).toBe('mysql://own');
    // the old ERP database the leave cut-over reads, when the modules share it
    expect(legacyCertUrlFromEnv('AB1', { LEGACY_LEAVE_DB_URL: 'mysql://leave' })).toBe(
      'mysql://leave',
    );
    expect(
      legacyCertUrlFromEnv('AB1', {
        LEGACY_LEAVE_DB_URL: 'mysql://leave',
        LEGACY_CERT_DB_URL: 'mysql://cert',
      }),
    ).toBe('mysql://cert');
  });

  it('reads nothing without the server’s connection and says why', async () => {
    const before = { all: process.env.LEGACY_CERT_DB_URL, leave: process.env.LEGACY_LEAVE_DB_URL };
    delete process.env.LEGACY_CERT_DB_URL;
    delete process.env.LEGACY_LEAVE_DB_URL;
    const school = await seedSchool(stamp('LC'));
    const db = newDb();
    try {
      expect(await readLegacyCertificates(db, school.id, log)).toBe(0);
    } finally {
      await db.close();
      if (before.all) process.env.LEGACY_CERT_DB_URL = before.all;
      if (before.leave) process.env.LEGACY_LEAVE_DB_URL = before.leave;
    }
    const r = await withMigrator((c) =>
      c.query<{ read_error: string | null; read_started_at: Date | null }>(
        `SELECT read_error, read_started_at FROM certificate_cutover WHERE school_id = $1`,
        [school.id],
      ),
    );
    expect(r.rows[0]!.read_error).toMatch(/LEGACY_CERT_DB_URL/);
    expect(r.rows[0]!.read_started_at).not.toBeNull();
  });
});
