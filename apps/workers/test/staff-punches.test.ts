import { describe, expect, it } from 'vitest';
import { centralQueries, centralSourceFromEnv } from '../src/processors/staff-punches';

describe('central punch source', () => {
  it('is off without the server’s settings, and takes plain names only', () => {
    expect(centralSourceFromEnv({})).toBeNull();
    const env = {
      STAFF_PUNCH_DB_URL: 'mysql://reader@localhost/punches',
      STAFF_PUNCH_TABLE: 'device_logs',
      STAFF_PUNCH_COL_ID: 'log_id',
      STAFF_PUNCH_COL_EMP: 'emp_code',
      STAFF_PUNCH_COL_TIME: 'log_time',
      STAFF_PUNCH_COL_DEVICE: 'serial_no',
    };
    const s = centralSourceFromEnv(env)!;
    expect(s.batch).toBe(2000);
    const q = centralQueries(s);
    expect(q.rows).toContain(
      'FROM `device_logs` WHERE `log_id` > ? AND `serial_no` IN (?) ORDER BY `log_id` LIMIT ?',
    );
    expect(q.top).toContain('SELECT MAX(w.`log_id`)');
    expect(() => centralSourceFromEnv({ ...env, STAFF_PUNCH_TABLE: 'logs; DROP TABLE x' })).toThrow(
      /plain/,
    );
  });
});
