import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { DecisionsService } from './decisions.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { ApplicantGuard } from './public/applicant.guard';
import { OtpService } from './public/otp.service';
import { PowService } from './public/pow.service';
import { PublicAdmissionsController } from './public/public-admissions.controller';
import { PublicAdmissionsService } from './public/public-admissions.service';
import { PublicThrottleGuard } from './public/public-throttle.guard';

/** Sprint 8: admission cycles, intake desk and the public applicant surface. */
@Module({
  imports: [WorkflowModule, PaymentsModule],
  controllers: [AdmissionsController, PublicAdmissionsController],
  providers: [
    AdmissionsService,
    DecisionsService,
    PublicAdmissionsService,
    PowService,
    OtpService,
    ApplicantGuard,
    PublicThrottleGuard,
    AuditService,
  ],
  exports: [
    AdmissionsService,
    PublicAdmissionsService,
    DecisionsService,
    OtpService,
    ApplicantGuard,
    PublicThrottleGuard,
  ],
})
export class AdmissionsModule implements OnModuleInit {
  constructor(
    private readonly decisions: DecisionsService,
    private readonly workflow: WorkflowService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.workflow.onComplete('application', (c, ctx, instance, outcome) =>
      this.decisions.onApprovalComplete(c, ctx, instance, outcome),
    );
    this.payments.onSuccess('admission_fee', (c, intent) => this.decisions.onFeePaid(c, intent));
  }
}
