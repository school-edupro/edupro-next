/**
 * Prisma with tenant context. Prisma has no hook for SET LOCAL, so every tenant-scoped use goes through an
 * interactive transaction whose first statement sets the context (ADR-002). Use this for typed CRUD; use
 * Db.withTenant() from ./index for procedures and reports.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { toPgArray, type TenantContext } from './index';

export type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: connectionString } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export async function prismaWithTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TenantPrisma) => Promise<T>,
): Promise<T> {
  if (!ctx.allowedSchoolIds.includes(ctx.schoolId)) {
    throw new Error('schoolId must be one of allowedSchoolIds');
  }
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // eslint-disable-next-line no-restricted-syntax -- Prisma tagged template binds every value as a parameter
      await tx.$executeRaw`
        SELECT set_config('app.school_id', ${ctx.schoolId}, true),
               set_config('app.user_id', ${ctx.userId ?? ''}, true),
               set_config('app.allowed_school_ids', ${toPgArray(ctx.allowedSchoolIds)}, true),
               set_config('app.academic_year_id', ${ctx.academicYearId ?? ''}, true),
               set_config('app.request_id', ${ctx.requestId ?? ''}, true),
               set_config('app.impersonated_by', ${ctx.impersonatedBy ?? ''}, true)`;
      return fn(tx as unknown as TenantPrisma);
    },
    { timeout: 15_000 },
  );
}
