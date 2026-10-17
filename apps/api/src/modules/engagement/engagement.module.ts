import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { FilesModule } from '../files/files.module';
import { CommsModule } from '../comms/comms.module';
import { PlatformModule } from '../platform/platform.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { ReportsModule } from '../reports/reports.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { ConsentFormsController, PublicConsentFormsController } from './consent-forms.controller';
import { ConsentPublicService } from './consent-public.service';
import { ConsentFormsService } from './consent-forms.service';
import { DsrController } from './dsr.controller';
import { DsrService } from './dsr.service';
import { EngagementController } from './engagement.controller';
import { FamilyService } from './family.service';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';
import { FrontOfficeService } from './front-office.service';
import { FrontOfficeController, GatePassController } from './gatepass.controller';
import { GatePassService } from './gatepass.service';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { EngagementPlusController } from './plus.controller';
import { EngagementPlusService } from './plus.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { PortalProfileController } from './portal-profile.controller';
import { PublicAppointmentsController } from './public-appointments.controller';
import { PublicVisitorsController, VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';
import { PortalProfileService } from './portal-profile.service';
import { PrivacyService } from './privacy.service';
import { QueriesService } from './queries.service';

/**
 * Sprint 10: parent queries, complaints and leave requests; feedback; profile change requests; family view.
 * Sprint 19: appointments, visitors and gate passes, consent forms, certificates, clinic, CCTV requests and
 * employee queries (the last approvals on the workflow engine).
 */
@Module({
  imports: [
    DailyAcademicsModule,
    CommsModule,
    WorkflowModule,
    PaymentsModule,
    ReportsModule,
    PlatformModule,
    FilesModule,
    AdmissionsModule,
  ],
  controllers: [
    EngagementController,
    EngagementPlusController,
    ConsentFormsController,
    PublicConsentFormsController,
    DsrController,
    PortalProfileController,
    HelpdeskController,
    AppointmentsController,
    PublicAppointmentsController,
    VisitorsController,
    PublicVisitorsController,
    GatePassController,
    FrontOfficeController,
    ClinicController,
  ],
  providers: [
    QueriesService,
    HelpdeskService,
    AppointmentsService,
    VisitorsService,
    GatePassService,
    FrontOfficeService,
    ClinicService,
    FamilyService,
    PortalProfileService,
    PrivacyService,
    EngagementPlusService,
    ConsentFormsService,
    ConsentPublicService,
    DsrService,
    AuditService,
  ],
  exports: [
    QueriesService,
    HelpdeskService,
    ClinicService,
    FamilyService,
    PrivacyService,
    EngagementPlusService,
    DsrService,
  ],
})
export class EngagementModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly workflow: WorkflowService,
    private readonly plus: EngagementPlusService,
    private readonly consents: ConsentFormsService,
  ) {}

  onModuleInit(): void {
    // consent forms: the last level decided (docs/design/28-consent-forms.md)
    this.workflow.onComplete('consent_response', (c, ctx, instance, outcome) =>
      this.consents.onDecision(c, ctx, instance, outcome),
    );
    for (const entityType of ['cctv_request', 'employee_query'])
      this.workflow.onComplete(entityType, (c, ctx, instance, outcome) =>
        this.plus.onWorkflowComplete(c, ctx, instance, outcome),
      );
  }
}
