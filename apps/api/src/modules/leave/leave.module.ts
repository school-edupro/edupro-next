import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { LeaveSetupController } from './leave-setup.controller';
import { LeaveSetupService } from './leave-setup.service';

/** Staff leave and attendance (docs/design/85). */
@Module({
  imports: [WorkflowModule],
  controllers: [LeaveSetupController],
  providers: [AuditService, LeaveSetupService],
})
export class LeaveModule {}
