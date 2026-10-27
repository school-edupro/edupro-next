import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { DecisionsService } from './decisions.service';
import { AdmissionFormsController } from './forms.controller';
import { AdmissionFormsService } from './forms.service';
import { AdmissionCoreService } from './admission-core.service';
import { AdmissionAdmitController } from './admit.controller';
import { AdmissionAdmitService } from './admit.service';
import { AdmissionDeskController } from './desk.controller';
import { AdmissionProcessController } from './process.controller';
import { AdmissionPapersService } from './papers.service';
import { AdmissionResultsController } from './results.controller';
import { AdmissionResultsService } from './results.service';
import { AdmissionProcessService } from './process.service';
import { AdmissionGridService } from './grid.service';
import { AdmissionApprovalsSheetService } from './approvals-sheet.service';
import { AdmissionCounterController } from './counter.controller';
import { AdmissionCounterService } from './counter.service';
import { AdmissionReadyReportsController } from './ready-reports.controller';
import { AdmissionReadyReportsService } from './ready-reports.service';
import { AR_FLOW, AdmissionRefundsService } from './refunds.service';
import { AdmissionEnquiryController } from './enquiry.controller';
import { AdmissionEnquiryService } from './enquiry.service';
import { AdmissionScheduleService } from './schedule.service';
import { AdmissionDeskService } from './desk.service';
import { AdmissionCandidateGuard } from './portal/candidate.guard';
import { CandidatePortalController } from './portal/candidate-portal.controller';
import { CandidatePortalService } from './portal/candidate-portal.service';
import { CandidateSigninService } from './portal/candidate-signin.service';
import { AdmissionSetupController } from './setup.controller';
import { AdmissionLateEntryService } from './late-entry.service';
import { AdmissionPointsService } from './points.service';
import { AdmissionSetupService } from './setup.service';
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
import { FilesModule } from '../files/files.module';
import { PublicSchoolController } from './public/public-school.controller';
import { PublicSchoolService } from './public/public-school.service';

/** Sprint 8: admission cycles, intake desk and the public applicant surface. */
import { AdmissionScoresController } from './scores.controller';
import { AdmissionApprovalsController } from './approvals.controller';
import { AdmissionApprovalsService } from './approvals.service';
import { AdmissionScoreTablesService } from './score-tables.service';
import { AdmissionScoreReportService } from './score-report.service';
import { AdmissionNumberSeriesService } from './number-series.service';

@Module({
  imports: [WorkflowModule, PaymentsModule, FilesModule],
  controllers: [
    AdmissionReadyReportsController,
    AdmissionCounterController,
    AdmissionsController,
    AdmissionFormsController,
    AdmissionSetupController,
    AdmissionDeskController,
    AdmissionProcessController,
    AdmissionAdmitController,
    AdmissionEnquiryController,
    AdmissionScoresController,
    AdmissionResultsController,
    AdmissionApprovalsController,
    CandidatePortalController,
    PublicAdmissionsController,
    PublicSchoolController,
  ],
  providers: [
    AdmissionsService,
    DecisionsService,
    AdmissionFormsService,
    AdmissionSetupService,
    AdmissionPointsService,
    AdmissionLateEntryService,
    AdmissionCoreService,
    AdmissionDeskService,
    AdmissionProcessService,
    AdmissionPapersService,
    AdmissionResultsService,
    AdmissionAdmitService,
    AdmissionGridService,
    AdmissionReadyReportsService,
    AdmissionCounterService,
    AdmissionRefundsService,
    AdmissionApprovalsSheetService,
    AdmissionEnquiryService,
    AdmissionScoreTablesService,
    AdmissionApprovalsService,
    AdmissionScoreReportService,
    AdmissionNumberSeriesService,
    AdmissionScheduleService,
    CandidatePortalService,
    CandidateSigninService,
    AdmissionCandidateGuard,
    PublicAdmissionsService,
    PublicSchoolService,
    PowService,
    OtpService,
    ApplicantGuard,
    PublicThrottleGuard,
    AuditService,
  ],
  exports: [
    AdmissionsService,
    AdmissionFormsService,
    AdmissionSetupService,
    AdmissionCoreService,
    CandidateSigninService,
    PublicAdmissionsService,
    DecisionsService,
    OtpService,
    PowService,
    ApplicantGuard,
    PublicThrottleGuard,
  ],
})
export class AdmissionsModule implements OnModuleInit {
  constructor(
    private readonly decisions: DecisionsService,
    private readonly workflow: WorkflowService,
    private readonly payments: PaymentsService,
    private readonly core: AdmissionCoreService,
    private readonly admit: AdmissionAdmitService,
    private readonly refunds: AdmissionRefundsService,
  ) {}

  onModuleInit(): void {
    // docs/design/54: an admission fee refund rides the levels of Fees → Approval
    this.workflow.onComplete(AR_FLOW.entityType, (c, ctx, instance, outcome) =>
      this.refunds.onApprovalComplete(c, ctx, instance, outcome),
    );
    this.workflow.onComplete('application', (c, ctx, instance, outcome) =>
      this.decisions.onApprovalComplete(c, ctx, instance, outcome),
    );
    this.payments.onSuccess('admission_fee', (c, intent) => this.decisions.onFeePaid(c, intent));
    // docs/design/39: the registration fee paid online registers the candidate
    this.payments.onSuccess('admission_fee', (c, intent) =>
      this.core.onRegistrationPaid(c, intent),
    );
    // part 6: the admission fee paid online gives the admission number
    this.payments.onSuccess('admission_fee', (c, intent) => this.admit.onAdmissionPaid(c, intent));
  }
}
