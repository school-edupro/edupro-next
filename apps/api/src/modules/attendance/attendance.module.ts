import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { CommsModule } from '../comms/comms.module';
import { AttendanceController, RfidController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { RfidService } from './rfid.service';

/** Sprint 9: attendance sessions and marks, absent alerts, RFID devices and ingestion v1. */
@Module({
  imports: [DailyAcademicsModule, CommsModule],
  controllers: [AttendanceController, RfidController],
  providers: [AttendanceService, RfidService, AuditService],
  exports: [AttendanceService, RfidService],
})
export class AttendanceModule {}
