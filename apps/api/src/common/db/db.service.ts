import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Db, type PoolClient, type TenantContext } from '@edupro/db';
import { ENV, type Env } from '../../config/env';

/**
 * Nest wrapper around @edupro/db. Repositories call `tenant(ctx, fn)`; nothing else touches the pool.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly raw: Db;

  private readonly logger = new Logger(DbService.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    this.raw = new Db({ connectionString: env.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    // ADR-002: never run as a role that can bypass row-level security.
    await this.raw.assertApplicationRole();
    // S5-05: refuse to serve a database that is not at the migration this build ships with.
    const mode = this.env.SCHEMA_CHECK ?? (this.env.NODE_ENV === 'production' ? 'strict' : 'warn');
    if (mode !== 'off') {
      const result = await this.raw.schemaVersion();
      if (!result.ok) {
        const message = `schema version mismatch: database at ${result.applied ?? 'none'}, build expects ${result.expected}`;
        if (mode === 'strict') throw new Error(`Refusing to start: ${message}`);
        this.logger.warn(message);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.close();
  }

  tenant<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.raw.withTenant(ctx, fn);
  }

  global<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.raw.withoutTenant(fn);
  }

  authLookup<T>(sub: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.raw.withAuthLookup(sub, fn);
  }
}
