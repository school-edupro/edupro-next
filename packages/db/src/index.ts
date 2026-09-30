/**
 * @edupro/db — tenant-aware PostgreSQL access.
 *
 * The only sanctioned way to run SQL against tenant tables is `Db.withTenant()`, which opens a transaction,
 * sets the transaction-local context that row-level security policies read (ADR-002), runs the callback and
 * commits. Nothing else in the codebase may hand out a raw pool client.
 */
import { checkSchemaVersion, type SchemaCheckResult } from './schema-version';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

export interface TenantContext {
  /** School the request acts on. Required. */
  schoolId: string;
  /** Acting user, or null for system jobs and device ingestion. */
  userId?: string | null;
  /** Schools the user is a member of (drives membership-filtered global tables). */
  allowedSchoolIds: readonly string[];
  /** Working academic year, if the request has one. */
  academicYearId?: string | null;
  /** Correlation id propagated to audit rows. */
  requestId?: string | null;
  /** Set only during an impersonation session. */
  impersonatedBy?: string | null;
}

export interface DbOptions {
  connectionString: string;
  /** Statement timeout in milliseconds applied to every tenant transaction. */
  statementTimeoutMs?: number;
  pool?: Omit<PoolConfig, 'connectionString'>;
}

/** Error raised when a tenant transaction is attempted without a school. */
export class TenantContextError extends Error {
  constructor(message = 'Tenant context requires a schoolId') {
    super(message);
    this.name = 'TenantContextError';
  }
}

const ID_PATTERN = /^[0-9]{1,18}$/;

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new TenantContextError(`${label} must be a numeric id string, received "${value}"`);
  }
}

/** Formats a list of ids as a PostgreSQL bigint[] literal: '{1,2,3}'. */
export function toPgArray(ids: readonly string[]): string {
  for (const id of ids) assertId(id, 'allowedSchoolIds entry');
  return `{${ids.join(',')}}`;
}

export class Db {
  readonly pool: Pool;
  private readonly statementTimeoutMs: number;

  constructor(options: DbOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'edupro-api',
      ...options.pool,
    });
    this.statementTimeoutMs = options.statementTimeoutMs ?? 15_000;
  }

  /**
   * Runs `fn` inside a transaction with the tenant context set. Rolls back on any error.
   * The context is set with set_config(..., is_local = true), so it is discarded at COMMIT/ROLLBACK and can
   * never leak to the next user of the pooled connection.
   */
  async withTenant<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!ctx.schoolId) throw new TenantContextError();
    assertId(ctx.schoolId, 'schoolId');
    if (ctx.userId) assertId(ctx.userId, 'userId');
    if (ctx.academicYearId) assertId(ctx.academicYearId, 'academicYearId');
    if (ctx.impersonatedBy) assertId(ctx.impersonatedBy, 'impersonatedBy');
    if (!ctx.allowedSchoolIds.includes(ctx.schoolId)) {
      throw new TenantContextError('schoolId must be one of allowedSchoolIds');
    }

    const client = await this.pool.connect();
    let released = false;
    const release = (destroy?: Error): void => {
      if (released) return;
      released = true;
      client.release(destroy);
    };
    try {
      await client.query('BEGIN');
      // eslint-disable-next-line no-restricted-syntax -- integer timeout from configuration; SET LOCAL takes no bound parameters
      await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
      await client.query(
        `SELECT set_config('app.school_id', $1, true),
                set_config('app.user_id', $2, true),
                set_config('app.allowed_school_ids', $3, true),
                set_config('app.academic_year_id', $4, true),
                set_config('app.request_id', $5, true),
                set_config('app.impersonated_by', $6, true)`,
        [
          ctx.schoolId,
          ctx.userId ?? '',
          toPgArray(ctx.allowedSchoolIds),
          ctx.academicYearId ?? '',
          ctx.requestId ?? '',
          ctx.impersonatedBy ?? '',
        ],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // The connection is unusable; hand it back with the error so the pool destroys it.
        release(rollbackError as Error);
      }
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Authentication-time lookup: resolves a user by One Auth subject and loads their memberships before any
   * school is selected. Uses the dedicated `app.auth_sub` setting that the users policy recognises.
   */
  async withAuthLookup<T>(sub: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // eslint-disable-next-line no-restricted-syntax -- integer timeout from configuration; SET LOCAL takes no bound parameters
      await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
      await client.query(`SELECT set_config('app.auth_sub', $1, true)`, [sub]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Runs `fn` without a tenant context. Only for global, non-tenant statements such as the permission
   * catalogue sync, health checks and maintenance. RLS still applies and hides all tenant rows.
   */
  async withoutTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // eslint-disable-next-line no-restricted-syntax -- integer timeout from configuration; SET LOCAL takes no bound parameters
      await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Startup safety check (ADR-002): the application must never connect as the owner or with BYPASSRLS.
   * Throws if the connected role could bypass row-level security.
   */
  async assertApplicationRole(): Promise<void> {
    const { rows } = await this.pool.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>('SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user');
    const role = rows[0];
    if (!role) throw new Error('Could not determine the current database role');
    if (role.rolbypassrls || role.rolsuper || role.rolname === 'edupro_migrator') {
      throw new Error(
        `Refusing to start: database role "${role.rolname}" can bypass row-level security. Connect as edupro_app.`,
      );
    }
  }

  /** Compares the applied migration with the one this package ships (S5-05). */
  async schemaVersion(): Promise<SchemaCheckResult> {
    return checkSchemaVersion(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type { PoolClient } from 'pg';
export {
  maskSensitive,
  isSensitiveKey,
  GLOBAL_SENSITIVE_KEYS,
  ENTITY_SENSITIVE_KEYS,
} from './audit-masks';
export * from './jobs';
export * from './datasets';
export * from './masters';
export * from './report-card-data';
export * from './report-card-html';
export * from './cron';
export * from './renderers';
export * from './schema-version';
export * from './template-engine';
export * from './document-data';
export * from './report-facts';
export * from './document-defaults';
export * from './admission-form';
export * from './student-fields';
export * from './student-profile';
export * from './field-crypto';
export * from './student-profile-store';
export * from './report-builder';
