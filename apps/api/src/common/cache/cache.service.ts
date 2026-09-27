import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';

/**
 * Small cache facade over Redis (S2-11). Keys are namespaced; values are JSON. When Redis is unreachable the
 * service degrades to an in-process map with the same TTL so a Redis outage never takes the API down; the
 * degradation is logged at warn level because cross-process invalidation is lost while it lasts.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private redisHealthy = true;
  private readonly local = new Map<string, { value: string; expiresAt: number }>();

  constructor(@Inject(ENV) env: Env) {
    this.redis = new IORedis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    this.redis.on('error', (error) => {
      if (this.redisHealthy)
        this.logger.warn(`redis unavailable, using in-process cache: ${error.message}`);
      this.redisHealthy = false;
    });
    this.redis.on('ready', () => {
      if (!this.redisHealthy) this.logger.log('redis connection restored');
      this.redisHealthy = true;
    });
    void this.redis.connect().catch(() => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redisHealthy) {
      try {
        const raw = await this.redis.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      } catch {
        // fall through to local
      }
    }
    const hit = this.local.get(key);
    if (hit && hit.expiresAt > Date.now()) return JSON.parse(hit.value) as T;
    this.local.delete(key);
    return null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redisHealthy) {
      try {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
        return;
      } catch {
        // fall through
      }
    }
    this.local.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Atomic counter with a window (S8 public throttling); the first hit starts the TTL. */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = `edupro:${key}`;
    if (this.redisHealthy) {
      try {
        const res = await this.redis.multi().incr(k).expire(k, ttlSeconds, 'NX').exec();
        const n = res?.[0]?.[1];
        if (typeof n === 'number') return n;
      } catch (error) {
        this.logger.warn(
          `redis incr failed, using in-process counter: ${(error as Error).message}`,
        );
      }
    }
    const now = Date.now();
    const cur = this.local.get(k);
    if (cur && cur.expiresAt > now) {
      const n = Number(cur.value) + 1;
      this.local.set(k, { value: String(n), expiresAt: cur.expiresAt });
      return n;
    }
    this.local.set(k, { value: '1', expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }

  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.local.delete(k);
    if (this.redisHealthy && keys.length > 0) {
      try {
        await this.redis.del(...keys);
      } catch {
        // ignore
      }
    }
  }

  /** Deletes every key matching a prefix (used when a role's permissions change). */
  async delByPrefix(prefix: string): Promise<void> {
    for (const k of [...this.local.keys()]) if (k.startsWith(prefix)) this.local.delete(k);
    if (!this.redisHealthy) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // ignore
    }
  }

  get healthy(): boolean {
    return this.redisHealthy;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
