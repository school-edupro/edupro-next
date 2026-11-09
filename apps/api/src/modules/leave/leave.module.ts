import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CommsModule } from '../comms/comms.module';
import { FilesModule } from '../files/files.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveCutoverController } from './cutover.controller';
import { LeaveCutoverService } from './cutover.service';
import { LeaveDashboardService } from './leave-dashboard.service';
import { LeaveOfficeService } from './leave-office.service';
import { LeaveReportsController } from './leave-reports.controller';
import { LeaveReportsService } from './leave-reports.service';
import { LeaveSetupController } from './leave-setup.controller';
import { LeaveSetupService } from './leave-setup.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

/** Staff leave and attendance (docs/design/85). */
@Module({
  imports: [WorkflowModule, CommsModule, FilesModule],
  controllers: [
    LeaveSetupController,
    LeaveController,
    AttendanceController,
    LeaveReportsController,
    LeaveCutoverController,
  ],
  providers: [
    AuditService,
    LeaveSetupService,
    LeaveService,
    LeaveOfficeService,
    AttendanceService,
    LeaveDashboardService,
    LeaveReportsService,
    LeaveCutoverService,
  ],
})
export class LeaveModule {}
