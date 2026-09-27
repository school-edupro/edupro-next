import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Adapters, ChannelAdapter } from '../src/adapters';
import { ConsoleAdapter } from '../src/adapters/console.adapter';
import { notificationProcessor } from '../src/processors/notifications';
import {
  log,
  newDb,
  seedSchool,
  stamp,
  tenantOf,
  withMigrator,
  type SeededSchool,
} from './helpers';

describe('notification processor (S3-02)', () => {
  const db = newDb();
  let school: SeededSchool;
  const consoleAdapter = new ConsoleAdapter(log);
  const failing: ChannelAdapter = {
    name: 'failing',
    async send() {
      throw new Error('provider down');
    },
  };
  const adapters = (sms: ChannelAdapter): Adapters => ({
    sms,
    whatsapp: consoleAdapter,
    email: consoleAdapter,
    push: consoleAdapter,
  });

  beforeAll(async () => {
    school = await seedSchool(stamp('WNT'));
  });
  afterAll(() => db.close());

  async function queueMessage(): Promise<string> {
    return db.withTenant(tenantOf(school), async (c) => {
      const t = await c.query<{ id: string }>(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, dlt_template_id, dlt_entity_id)
         VALUES (app.current_school_id(), $1, 'sms', 'Fee reminder', 'Dear {{name}}, fees are due', '1107160000000000001', '1101000000000000001') RETURNING id::text`,
        [`fee_due_${Date.now().toString(36)}`],
      );
      const m = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, body, variables)
         VALUES (app.current_school_id(), $1, 'sms', $2, '9999999999', 'Dear Asha, fees are due', '{"name":"Asha"}'::jsonb) RETURNING id::text`,
        [t.rows[0]!.id, school.userId],
      );
      return m.rows[0]!.id;
    });
  }

  const envelope = (messageId: string) => ({
    schoolId: school.id,
    userId: school.userId,
    requestId: null,
    kind: 'comms.message',
    payload: { messageId },
  });

  it('delivers through the channel adapter and records the provider outcome', async () => {
    const messageId = await queueMessage();
    await notificationProcessor(
      db,
      adapters(consoleAdapter),
      log,
    )({ data: envelope(messageId), attemptsMade: 0, opts: { attempts: 3 } });
    const row = await withMigrator((c) =>
      c.query(
        'SELECT status, provider, provider_message_id, attempts, sent_at, delivered_at FROM comms_messages WHERE id = $1',
        [messageId],
      ),
    );
    expect(row.rows[0]).toMatchObject({
      status: 'delivered',
      provider: 'console',
      provider_message_id: `console-${messageId}`,
      attempts: 1,
    });
    expect(row.rows[0].sent_at).not.toBeNull();
  });

  it('records a provider failure, keeps the row queued until the last attempt, then marks it failed', async () => {
    const messageId = await queueMessage();
    const processor = notificationProcessor(db, adapters(failing), log);
    await expect(
      processor({ data: envelope(messageId), attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow('provider down');
    let row = await withMigrator((c) =>
      c.query('SELECT status, attempts, last_error FROM comms_messages WHERE id = $1', [messageId]),
    );
    expect(row.rows[0]).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error: 'provider down',
    });
    await expect(
      processor({ data: envelope(messageId), attemptsMade: 2, opts: { attempts: 3 } }),
    ).rejects.toThrow('provider down');
    row = await withMigrator((c) =>
      c.query('SELECT status, attempts, failed_at FROM comms_messages WHERE id = $1', [messageId]),
    );
    expect(row.rows[0]).toMatchObject({ status: 'failed', attempts: 2 });
    expect(row.rows[0].failed_at).not.toBeNull();
  });

  it('skips cancelled messages', async () => {
    const messageId = await queueMessage();
    await withMigrator((c) =>
      c.query("UPDATE comms_messages SET status = 'cancelled' WHERE id = $1", [messageId]),
    );
    await notificationProcessor(
      db,
      adapters(consoleAdapter),
      log,
    )({ data: envelope(messageId), attemptsMade: 0, opts: { attempts: 3 } });
    const row = await withMigrator((c) =>
      c.query('SELECT status, attempts FROM comms_messages WHERE id = $1', [messageId]),
    );
    expect(row.rows[0]).toMatchObject({ status: 'cancelled', attempts: 0 });
  });
});
