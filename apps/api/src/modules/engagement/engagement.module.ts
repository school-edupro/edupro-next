import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { CommsModule } from '../comms/comms.module';
import { PlatformModule } from '../platform/platform.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { ReportsModule } from '../reports/reports.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { DsrController } from './dsr.controller';
import { DsrService } from './dsr.service';
import { EngagementController } from './engagement.controller';
import { FamilyService } from './family.service';
import { EngagementPlusController } from './plus.controller';
import { EngagementPlusService } from './plus.service';
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
  ],
  controllers: [EngagementController, EngagementPlusController, DsrController],
  providers: [
    QueriesService,
    FamilyService,
    PrivacyService,
    EngagementPlusService,
    DsrService,
    AuditService,
  ],
  exports: [QueriesService, FamilyService, PrivacyService, EngagementPlusService, DsrService],
})
export class EngagementModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly workflow: WorkflowService,
    private readonly plus: EngagementPlusService,
  ) {}

  onModuleInit(): void {
    // Sprint 19: a paid consent-form fee marks the response paid (purpose misc, entity consent_form_response)
    this.payments.onSuccess('misc', async (c, intent) => {
      if (intent.entityType !== 'consent_form_response') return;
      await c.query(
        `UPDATE consent_form_responses SET paid_at = now() WHERE id = $1 AND paid_at IS NULL`,
        [intent.entityId],
      );
    });
    for (const entityType of ['appointment_request', 'gate_pass', 'cctv_request', 'employee_query'])
      this.workflow.onComplete(entityType, (c, ctx, instance, outcome) =>
        this.plus.onWorkflowComplete(c, ctx, instance, outcome),
      );
  }
}
