import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { CommsModule } from '../comms/comms.module';
import { TemplatesModule } from '../platform/templates/templates.module';
import { ReportsModule } from '../reports/reports.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { FeeAdjustmentsService } from './fee-adjustments.service';
import { FeeDemandsService } from './fee-demands.service';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeMastersService } from './fee-masters.service';
import { FeeReportsService } from './fee-reports.service';
import { FeesController } from './fees.controller';

/**
 * Sprint 8: fee engine start (masters, student profiles, demand generation); Sprint 12: ledger, late fee,
 * receipts; Sprint 14: adjustments, category and discount changes through the workflow, misc receipts,
 * hostel ledger, reconciliation.
 */
@Module({
  imports: [ReportsModule, TemplatesModule, DailyAcademicsModule, WorkflowModule, CommsModule],
  controllers: [FeesController],
  providers: [
    FeeMastersService,
    FeeDemandsService,
    FeeLedgerService,
    FeeAdjustmentsService,
    FeeReportsService,
    AuditService,
  ],
  exports: [FeeMastersService, FeeDemandsService, FeeLedgerService, FeeAdjustmentsService],
})
export class FeesModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly adjustments: FeeAdjustmentsService,
  ) {}

  onModuleInit(): void {
    this.workflow.onComplete('fee_profile_change', (c, ctx, instance, outcome) =>
      this.adjustments.onWorkflowComplete(c, ctx, instance, outcome),
    );
  }
}
