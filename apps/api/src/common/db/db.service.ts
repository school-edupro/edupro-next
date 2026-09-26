import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Db, type PoolClient, type TenantContext } from '@edupro/db';
import { ENV, type Env } from '../../config/env';

/**
 * Nest wrapper around @edupro/db. Repositories call `tenant(ctx, fn)`; nothing else touches the pool.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly raw: Db;

  constructor(@Inject(ENV) env: Env) {
    this.raw = new Db({ connectionString: env.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    // ADR-002: never run as a role that can bypass row-level security.
    await this.raw.assertApplicationRole();
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
