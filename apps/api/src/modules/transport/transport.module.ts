import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { FleetService } from './fleet.service';
import { TransportRequestsService } from './transport-requests.service';
import {
  FleetController,
  TransportController,
  TransportRequestsController,
} from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Sprint 10: routes and student assignments; Sprint 12: stops with geo, vehicles and drivers; Sprint 13:
 * family requests through the workflow engine and vehicle logs.
 */
@Module({
  imports: [DailyAcademicsModule, WorkflowModule],
  controllers: [TransportController, FleetController, TransportRequestsController],
  providers: [TransportService, FleetService, TransportRequestsService, AuditService],
  exports: [TransportService, FleetService, TransportRequestsService],
})
export class TransportModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly requests: TransportRequestsService,
  ) {}

  onModuleInit(): void {
    this.workflow.onComplete('transport_request', (c, ctx, instance, outcome) =>
      this.requests.onWorkflowComplete(c, ctx, instance, outcome),
    );
  }
}
