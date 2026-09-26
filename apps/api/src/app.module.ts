import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { PermissionGuard } from './common/access/permission.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditService } from './common/audit/audit.service';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { DbModule } from './common/db/db.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { TenantGuard } from './common/tenant/tenant.guard';
import { EnvModule } from './config/env.module';
import { ClassesModule } from './modules/academics/classes/classes.module';
import { AccessModule } from './modules/access/access.module';
import { HealthController } from './modules/health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { MeController } from './modules/me/me.controller';

/**
 * Guard order is the security model (design section 3): authenticate, resolve tenant, authorise.
 * Nest runs APP_GUARD providers in registration order.
 */
@Module({
  imports: [EnvModule, DiscoveryModule, DbModule, IdentityModule, AccessModule, ClassesModule],
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
