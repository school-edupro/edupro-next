import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

/** Sprint 9: workflow engine v0 (definitions, resolvers, instances, steps, inbox). */
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, AuditService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
