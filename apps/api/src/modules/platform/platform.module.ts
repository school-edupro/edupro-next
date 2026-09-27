import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ReportsModule } from '../reports/reports.module';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';
import { JobsService } from './jobs.service';
import { PlatformController } from './platform.controller';
import { SchoolService } from './school.service';
import { SettingsService } from './settings.service';
import { YearsService } from './years.service';

@Module({
  imports: [ReportsModule],
  controllers: [PlatformController, AuditController],
  providers: [
    SettingsService,
    YearsService,
    SchoolService,
    AuditQueryService,
    JobsService,
    AuditService,
  ],
  exports: [SettingsService, YearsService, SchoolService],
})
export class PlatformModule {}
