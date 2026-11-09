import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CommsModule } from '../comms/comms.module';
import { FilesModule } from '../files/files.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { LeaveOfficeService } from './leave-office.service';
import { LeaveSetupController } from './leave-setup.controller';
import { LeaveSetupService } from './leave-setup.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

/** Staff leave and attendance (docs/design/85). */
@Module({
  imports: [WorkflowModule, CommsModule, FilesModule],
  controllers: [LeaveSetupController, LeaveController],
  providers: [AuditService, LeaveSetupService, LeaveService, LeaveOfficeService],
})
export class LeaveModule {}
