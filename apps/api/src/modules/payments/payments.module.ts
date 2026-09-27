import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Sprint 9: payments v0. Fee instalment successes allocate to demands; admission fees are handled by admissions. */
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, AuditService],
  exports: [PaymentsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(private readonly payments: PaymentsService) {}
  onModuleInit(): void {
    this.payments.onSuccess('fee_instalment', (c, intent) =>
      this.payments.applyFeeInstalment(c, intent),
    );
  }
}
