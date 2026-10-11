import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { FeesModule } from '../../fees/fees.module';
import { FilesModule } from '../../files/files.module';
import { TemplatesModule } from '../../platform/templates/templates.module';
import { ReportsModule } from '../../reports/reports.module';
import { WorkflowModule } from '../../workflow/workflow.module';
import { WorkflowService } from '../../workflow/workflow.service';
import { LifecycleController } from './lifecycle.controller';
import { PromotionsService } from './promotions.service';
import { TcService } from './tc.service';
import { TransfersService } from './transfers.service';
import { WithdrawalsService } from './withdrawals.service';

/** Transfers between schools of the group, transfer certificates, withdrawal clearance by configured departments, promotion decisions. */
@Module({
  imports: [ReportsModule, TemplatesModule, FeesModule, FilesModule, WorkflowModule],
  controllers: [LifecycleController],
  providers: [TcService, WithdrawalsService, PromotionsService, TransfersService, AuditService],
  exports: [TcService, WithdrawalsService, PromotionsService],
})
export class LifecycleModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  onModuleInit(): void {
    // the revoke of a completed withdrawal rides the fee approval levels (WithdrawalsService.requestRevoke)
    this.workflow.onComplete('withdrawal_revoke', (c, ctx, instance, outcome) =>
      this.withdrawals.onRevokeComplete(c, ctx, instance, outcome),
    );
  }
}
