import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { PermissionGuard } from './common/access/permission.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditService } from './common/audit/audit.service';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { CacheModule } from './common/cache/cache.module';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { TenantGuard } from './common/tenant/tenant.guard';
import { EnvModule } from './config/env.module';
import { ClassesModule } from './modules/academics/classes/classes.module';
import { AccessModule } from './modules/access/access.module';
import { CommsModule } from './modules/comms/comms.module';
import { FilesModule } from './modules/files/files.module';
import { HealthController } from './modules/health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { MeController } from './modules/me/me.controller';
import { PlatformModule } from './modules/platform/platform.module';
import { ReportsModule } from './modules/reports/reports.module';

/**
 * Guard order is the security model (design section 3): authenticate, resolve tenant, authorise.
 * Nest runs APP_GUARD providers in registration order.
 */
@Module({
  imports: [
    EnvModule,
    DiscoveryModule,
    DbModule,
    CacheModule,
    JobsModule,
    IdentityModule,
    AccessModule,
    FilesModule,
    ReportsModule,
    PlatformModule,
    CommsModule,
    ClassesModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    AuditService,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
