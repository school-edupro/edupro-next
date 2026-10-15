import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { FeesModule } from '../fees/fees.module';
import { BankStatementsController } from './bank-statements.controller';
import { BankStatementsService } from './bank-statements.service';
import { GatewaysController } from './gateways.controller';
import { GatewaysService } from './gateways.service';
import { PaymentsController } from './payments.controller';
import { MiscFeesService } from '../fees/misc-fees.service';
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
  controllers: [PaymentsController, BankStatementsController, GatewaysController],
  providers: [
    GatewaysService,
    PaymentsService,
    RefundsService,
    SettlementsService,
    BankStatementsService,
    AuditService,
  ],
  exports: [
    PaymentsService,
    GatewaysService,
    RefundsService,
    SettlementsService,
    BankStatementsService,
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly workflow: WorkflowService,
    private readonly miscFees: MiscFeesService,
  ) {}
  onModuleInit(): void {
    this.payments.onSuccess('fee_instalment', (c, intent) =>
      this.payments.applyFeeInstalment(c, intent),
    );
    // a misc fee paid online writes its MF receipt (consent-form fees share the purpose; each picks its entity)
    this.payments.onSuccess('misc', async (c, intent) => {
      if (intent.entityType === 'misc_fee_student') await this.miscFees.onlinePaid(c, intent);
    });
    this.payments.onRefundEvent((c, ev) => this.refunds.onProviderRefund(c, ev));
    // refunds ride the fee approval levels (Fee setup -> Approval levels)
    this.workflow.onComplete('fee_refund', (c, ctx, instance, outcome) =>
      this.refunds.onWorkflowComplete(c, ctx, instance, outcome),
    );
  }
}
