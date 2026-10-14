/** System -> Jobs: whether the worker processes are running, read from the heartbeat they write to Redis. */
import IORedis from 'ioredis';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

describe('workers panel (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const s = stamp('WRK');
  const live = `test-${s}-live`;
  const old = `test-${s}-old`;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await redis.hdel('edupro:workers', live, old);
    await redis.quit();
    if (app) await app.close();
  });

  const get = (u: SeededUser) =>
    inject({ method: 'GET', url: '/platform/jobs/workers', headers: headersFor(u.sub, school.id) });

  it('shows a process that reported lately as running, one silent for minutes as stopped', async () => {
    const report = (id: string, at: Date) =>
      JSON.stringify({
        id,
        host: 'test',
        pid: 1,
        startedAt: at.toISOString(),
        at: at.toISOString(),
        queues: [{ name: 'notifications', done: 3, failed: 1, counts: { waiting: 2 } }],
      });
    await redis.hset('edupro:workers', old, report(old, new Date(Date.now() - 10 * 60 * 1000)));
    const before = (await get(admin)).json() as {
      processes: Array<{ id: string; alive: boolean }>;
      school: Record<string, string>;
    };
    expect(before.processes.find((p) => p.id === old)).toMatchObject({ alive: false });
    expect(before.school).toMatchObject({ messagesQueued: '0', outboxFailed: '0' });
    await redis.hset('edupro:workers', live, report(live, new Date()));
    const after = (await get(admin)).json() as {
      running: boolean;
      processes: Array<{ id: string; alive: boolean; queues: unknown[] }>;
    };
    expect(after.running).toBe(true);
    expect(after.processes[0]).toMatchObject({ id: live, alive: true });
  });

  it('is for those who may see the jobs', async () => {
    expect((await get(teacher)).statusCode).toBe(403);
  });
});
