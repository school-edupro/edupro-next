import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { HostelController } from './hostel.controller';
import { HostelLifeController } from './hostel-life.controller';
import { HostelLifeService } from './hostel-life.service';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';

/** Hostel module (docs/design/25-hostel-module.md): set-up, wardens, bed allotment and occupancy. */
@Module({
  controllers: [HostelController, HostelLifeController],
  providers: [HostelService, HostelImportService, HostelLifeService, AuditService],
  exports: [HostelService],
})
export class HostelModule {}
