import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { HostelController } from './hostel.controller';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';

/** Hostel module (docs/design/25-hostel-module.md): set-up, wardens, bed allotment and occupancy. */
@Module({
  controllers: [HostelController],
  providers: [HostelService, HostelImportService, AuditService],
  exports: [HostelService],
})
export class HostelModule {}
