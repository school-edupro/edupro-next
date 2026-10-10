import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { FeesModule } from '../fees/fees.module';
import { BankStatementsController } from './bank-statements.controller';
import { BankStatementsService } from './bank-statements.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { SettlementsService } from './settlements.service';

/**
 * Sprint 9: payments v0. Sprint 13: gateway adapters, receipts through app.post_receipt, refunds and
 * settlements, a family's own online payment. Fee instalment successes post a receipt; admission fees are
 * handled by admissions.
 */
@Module({
  imports: [FeesModule, DailyAcademicsModule, WorkflowModule],
  controllers: [PaymentsController, BankStatementsController],
  providers: [
    PaymentsService,
    RefundsService,
    SettlementsService,
    BankStatementsService,
    AuditService,
  ],
  exports: [PaymentsService, RefundsService, SettlementsService, BankStatementsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly workflow: WorkflowService,
  ) {}
  onModuleInit(): void {
    this.payments.onSuccess('fee_instalment', (c, intent) =>
      this.payments.applyFeeInstalment(c, intent),
    );
    this.payments.onRefundEvent((c, ev) => this.refunds.onProviderRefund(c, ev));
    // refunds ride the fee approval levels (Fee setup -> Approval levels)
    this.workflow.onComplete('fee_refund', (c, ctx, instance, outcome) =>
      this.refunds.onWorkflowComplete(c, ctx, instance, outcome),
    );
  }
}
