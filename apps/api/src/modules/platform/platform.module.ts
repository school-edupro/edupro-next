import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ReportsModule } from '../reports/reports.module';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';
import { FamilyLayoutController } from './family-layout.controller';
import { FamilyLayoutService } from './family-layout.service';
import { JobsService } from './jobs.service';
import { PlatformController } from './platform.controller';
import { SchoolService } from './school.service';
import { SettingsService } from './settings.service';
import { YearsService } from './years.service';

@Module({
  imports: [ReportsModule],
  controllers: [PlatformController, AuditController, FamilyLayoutController],
  providers: [
    SettingsService,
    YearsService,
    SchoolService,
    AuditQueryService,
    JobsService,
    FamilyLayoutService,
    AuditService,
  ],
  exports: [SettingsService, YearsService, SchoolService, FamilyLayoutService],
})
export class PlatformModule {}
