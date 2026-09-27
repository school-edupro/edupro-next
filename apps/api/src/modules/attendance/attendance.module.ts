import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { CommsModule } from '../comms/comms.module';
import {
  AttendanceController,
  BusController,
  PunchController,
  RfidController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { BusService } from './bus.service';
import { PunchService } from './punch.service';
import { RfidService } from './rfid.service';

/** Sprint 9: sessions, marks, absent alerts, RFID gates. Sprint 10: bus readers, biometric punches, dashboards. */
@Module({
  imports: [DailyAcademicsModule, CommsModule],
  controllers: [AttendanceController, RfidController, BusController, PunchController],
  providers: [AttendanceService, RfidService, BusService, PunchService, AuditService],
  exports: [AttendanceService, RfidService, BusService, PunchService],
})
export class AttendanceModule {}
