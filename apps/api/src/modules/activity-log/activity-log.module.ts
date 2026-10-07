import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';

/** The employee's daily activity log: time slots of the day, submitted by the employee, reviewed by exception. */
@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService, AuditService],
})
export class ActivityLogModule {}
