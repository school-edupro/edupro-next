import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ReportsModule } from '../reports/reports.module';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';
import { FamilyLayoutController } from './family-layout.controller';
import { FamilyLayoutService } from './family-layout.service';
import { InternalCalls } from '../../common/http/internal-calls';
import { StaffWaitingService } from '../me/staff-waiting.service';
import { StaffLayoutController } from './staff-layout.controller';
import { StaffLayoutService } from './staff-layout.service';
import { JobsService } from './jobs.service';
import { PlatformController } from './platform.controller';
import { SchoolService } from './school.service';
import { SettingsService } from './settings.service';
import { YearsService } from './years.service';

@Module({
  imports: [ReportsModule],
  controllers: [PlatformController, AuditController, FamilyLayoutController, StaffLayoutController],
  providers: [
    SettingsService,
    YearsService,
    SchoolService,
    AuditQueryService,
    JobsService,
    FamilyLayoutService,
    StaffLayoutService,
    StaffWaitingService,
    InternalCalls,
    AuditService,
  ],
  exports: [
    SettingsService,
    YearsService,
    SchoolService,
    FamilyLayoutService,
    StaffWaitingService,
    StaffLayoutService,
  ],
})
export class PlatformModule {}
