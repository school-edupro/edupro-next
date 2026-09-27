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
import { SecurityModule } from './common/security/security.module';
import { TenantGuard } from './common/tenant/tenant.guard';
import { EnvModule } from './config/env.module';
import { ClassesModule } from './modules/academics/classes/classes.module';
import { AcademicsSetupModule } from './modules/academics/setup/academics-setup.module';
import { DailyAcademicsModule } from './modules/academics/daily/daily.module';
import { LifecycleModule } from './modules/people/lifecycle/lifecycle.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { FeesModule } from './modules/fees/fees.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { TransportModule } from './modules/transport/transport.module';
import { TemplatesModule } from './modules/platform/templates/templates.module';
import { AccessModule } from './modules/access/access.module';
import { CommsModule } from './modules/comms/comms.module';
import { CompatModule } from './modules/compat/compat.module';
import { FilesModule } from './modules/files/files.module';
import { HealthController } from './modules/health/health.controller';
import { MetricsController } from './modules/health/metrics.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { MeController } from './modules/me/me.controller';
import { PeopleModule } from './modules/people/people.module';
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
    SecurityModule,
    JobsModule,
    IdentityModule,
    AccessModule,
    FilesModule,
    ReportsModule,
    PlatformModule,
    CommsModule,
    ClassesModule,
    AcademicsSetupModule,
    DailyAcademicsModule,
    TemplatesModule,
    LifecycleModule,
    WorkflowModule,
    PaymentsModule,
    AdmissionsModule,
    FeesModule,
    AttendanceModule,
    TransportModule,
    EngagementModule,
    PeopleModule,
    CompatModule,
  ],
  controllers: [HealthController, MetricsController, MeController],
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
