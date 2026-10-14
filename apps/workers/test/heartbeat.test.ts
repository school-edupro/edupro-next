import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(public name: string) {}
    getJobCounts() {
      return Promise.resolve({ waiting: 2, active: 1, delayed: 0, failed: 3 });
    }
    close() {
      return Promise.resolve();
    }
  },
}));

const { HEARTBEAT_KEY, startHeartbeat } = await import('../src/heartbeat');

describe('worker heartbeat', () => {
  it('reports the queues, counts what was done and failed, and removes itself on stop', async () => {
    const store = new Map<string, string>();
    const redis = {
      hset: vi.fn((key: string, field: string, value: string) => {
        expect(key).toBe(HEARTBEAT_KEY);
        store.set(field, value);
        return Promise.resolve(1);
      }),
      hdel: vi.fn((_key: string, field: string) => {
        store.delete(field);
        return Promise.resolve(1);
      }),
    };
    const worker = Object.assign(new EventEmitter(), { name: 'notifications' });
    const beat = startHeartbeat(redis as never, [worker as never], { storage: 'fs', pdf: 'none' });
    worker.emit('completed', {});
    worker.emit('completed', {});
    worker.emit('failed', {}, new Error('gateway refused'));
    await vi.waitFor(() => expect(store.size).toBe(1));
    await beat.stop();
    expect(store.size).toBe(0);
    expect(redis.hdel).toHaveBeenCalledTimes(1);
  });

  it('a report carries the counts of each queue', async () => {
    const store = new Map<string, string>();
    const redis = {
      hset: (_k: string, f: string, v: string) => (store.set(f, v), Promise.resolve(1)),
      hdel: () => Promise.resolve(1),
    };
    const worker = Object.assign(new EventEmitter(), { name: 'exports' });
    const beat = startHeartbeat(redis as never, [worker as never], { storage: 'fs', pdf: 'none' });
    await vi.waitFor(() => expect(store.size).toBe(1));
    const report = JSON.parse([...store.values()][0]!) as {
      pid: number;
      queues: Array<{ name: string; counts: { waiting: number }; done: number }>;
    };
    expect(report.pid).toBe(process.pid);
    expect(report.queues[0]).toMatchObject({ name: 'exports', done: 0, counts: { waiting: 2 } });
    await beat.stop();
  });
});
