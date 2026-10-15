import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { HostelController } from './hostel.controller';
import { HostelLifeController } from './hostel-life.controller';
import { HostelLifeService } from './hostel-life.service';
import { HostelH3Controller } from './hostel-h3.controller';
import { HostelMessService } from './hostel-mess.service';
import { HostelVisitsService } from './hostel-visits.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';

/** Hostel module (docs/design/25-hostel-module.md): set-up, wardens, bed allotment and occupancy. */
@Module({
  imports: [DailyAcademicsModule],
  controllers: [HostelController, HostelLifeController, HostelH3Controller],
  providers: [
    HostelService,
    HostelImportService,
    HostelLifeService,
    HostelVisitsService,
    HostelMessService,
    AuditService,
  ],
  exports: [HostelService],
})
export class HostelModule {}
