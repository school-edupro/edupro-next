import { hostname } from 'node:os';
import { Queue, type Worker } from 'bullmq';
import type IORedis from 'ioredis';

/** Where every worker process reports itself; System -> Jobs reads it. */
export const HEARTBEAT_KEY = 'edupro:workers';
const EVERY_MS = 20_000;

interface QueueStats {
  done: number;
  failed: number;
  lastDoneAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
}

/**
 * A worker process says it is alive every 20 seconds: when it started, which queues it serves, what
 * it has done and failed since it started, and how many jobs wait in each queue. A process that stops
 * reporting is shown as not running; it removes itself when it shuts down cleanly.
 */
export function startHeartbeat(
  connection: IORedis,
  workers: Array<Worker>,
  info: { storage: string; pdf: string },
) {
  const id = `${hostname()}:${String(process.pid)}`;
  const startedAt = new Date().toISOString();
  const stats = new Map<string, QueueStats>();
  const queues = workers.map((w) => new Queue(w.name, { connection }));
  for (const w of workers) {
    const s: QueueStats = {
      done: 0,
      failed: 0,
      lastDoneAt: null,
      lastFailedAt: null,
      lastError: null,
    };
    stats.set(w.name, s);
    w.on('completed', () => {
      s.done += 1;
      s.lastDoneAt = new Date().toISOString();
    });
    w.on('failed', (_job, error) => {
      s.failed += 1;
      s.lastFailedAt = new Date().toISOString();
      s.lastError = error.message.slice(0, 200);
    });
  }
  const beat = async () => {
    const counts = await Promise.all(
      queues.map((q) => q.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null)),
    );
    const report = {
      id,
      host: hostname(),
      pid: process.pid,
      startedAt,
      at: new Date().toISOString(),
      storage: info.storage,
      pdf: info.pdf,
      queues: queues.map((q, i) => ({ name: q.name, ...stats.get(q.name), counts: counts[i] })),
    };
    await connection.hset(HEARTBEAT_KEY, id, JSON.stringify(report)).catch(() => undefined);
  };
  void beat();
  const timer = setInterval(() => void beat(), EVERY_MS);
  return {
    async stop() {
      clearInterval(timer);
      await connection.hdel(HEARTBEAT_KEY, id).catch(() => undefined);
      await Promise.all(queues.map((q) => q.close()));
    },
  };
}
