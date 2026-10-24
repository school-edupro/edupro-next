import { AcrController } from './acr.controller';
import { EmployeeSelfController } from './employee-self.controller';
import { EmployeeSelfService } from './employee-self.service';
import { PeopleDashboardController } from './people-dashboard.controller';
import { PeopleDashboardService } from './people-dashboard.service';
import { AcrFlowService } from './acr-flow.service';
import { AcrSetupService } from './acr-setup.service';
import { EmployeeTransferController } from './employee-transfer.controller';
import { EmployeeTransferService } from './employee-transfer.service';
import { EmployeeBulkService } from './employee-bulk.service';
import { EmployeeGridService } from './employee-grid.service';
import { EmployeeProfileController } from './employee-profile.controller';
import { EmployeeProfileService } from './employee-profile.service';
import { SectionRollController } from './section-roll.controller';
import { SectionRollService } from './section-roll.service';
import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { ReportsModule } from '../reports/reports.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AdmissionsModule } from '../admissions/admissions.module';
import { CommsModule } from '../comms/comms.module';
import { MastersModule } from '../masters/masters.module';
import { MastersService } from '../masters/masters.service';
import { RecruitmentApprovalService } from './recruitment-approval.service';
import { ApplicationPdfService } from './application-pdf.service';
import { RecruitmentCorrectionsService } from './recruitment-corrections.service';
import { RecruitmentExportService } from './recruitment-export.service';
import { CandidateAuthService } from './candidate-auth.service';
import { CandidateGuard } from './candidate.guard';
import { RecruitmentPublicController } from './recruitment-public.controller';
import { RecruitmentPublicService } from './recruitment-public.service';
import { RecruitmentScreeningService } from './recruitment-screening.service';
import { RecruitmentJoinService } from './recruitment-join.service';
import { WorkflowService } from '../workflow/workflow.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { StudentCorrectionsController } from './student-corrections.controller';
import { StudentCorrectionsService } from './student-corrections.service';
import { ClassCorrectionsService } from './class-corrections.service';
import { StudentMergesController } from './student-merges.controller';
import { ExitSetupService } from './exits/exit-setup.service';
import { ExitsController } from './exits/exits.controller';
import { ExitsService } from './exits/exits.service';
import { StudentMergesService } from './student-merges.service';
import { StudentBulkService } from './student-bulk.service';
import { StudentGridService } from './student-grid.service';
import { StudentProfileController } from './student-profile.controller';
import { StudentProfileService } from './student-profile.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [
    FilesModule,
    ReportsModule,
    WorkflowModule,
    AdmissionsModule,
    CommsModule,
    MastersModule,
  ],
  controllers: [
    EmployeeSelfController,
    PeopleDashboardController,
    AcrController,
    RecruitmentController,
    RecruitmentPublicController,
    EmployeeProfileController,
    EmployeeTransferController,
    SectionRollController,
    StudentCorrectionsController,
    StudentMergesController,
    ExitsController,
    StudentProfileController,
    StudentsController,
    EmployeesController,
    SearchController,
    ImportsController,
  ],
  providers: [
    EmployeeSelfService,
    PeopleDashboardService,
    AcrSetupService,
    AcrFlowService,
    RecruitmentService,
    RecruitmentApprovalService,
    ApplicationPdfService,
    RecruitmentCorrectionsService,
    RecruitmentExportService,
    RecruitmentPublicService,
    RecruitmentScreeningService,
    RecruitmentJoinService,
    CandidateAuthService,
    CandidateGuard,
    EmployeeProfileService,
    EmployeeGridService,
    EmployeeBulkService,
    EmployeeTransferService,
    SectionRollService,
    StudentBulkService,
    StudentCorrectionsService,
    ClassCorrectionsService,
    StudentMergesService,
    ExitSetupService,
    ExitsService,
    StudentGridService,
    StudentProfileService,
    StudentsService,
    EmployeesService,
    SearchService,
    ImportsService,
    AuditService,
  ],
  exports: [StudentsService, EmployeesService, StudentProfileService],
})
export class PeopleModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly recruitment: RecruitmentService,
    private readonly approval: RecruitmentApprovalService,
    private readonly masters: MastersService,
    private readonly corrections: StudentCorrectionsService,
    private readonly classCorrections: ClassCorrectionsService,
    private readonly merges: StudentMergesService,
    private readonly exits: ExitsService,
  ) {}

  onModuleInit() {
    // a vacancy's approval decided at the last level (0197)
    this.workflow.onComplete('vacancy', (c, ctx, instance, outcome) =>
      this.recruitment.onDecision(c, ctx, instance, outcome),
    );
    // a student detail correction decided at the last level, or withdrawn (0232)
    this.workflow.onComplete('student_correction', (c, ctx, instance, outcome) =>
      this.corrections.onDecision(c, ctx, instance, outcome),
    );
    // a class correction decided at the last level, or withdrawn (0234)
    this.workflow.onComplete('class_correction', (c, ctx, instance, outcome) =>
      this.classCorrections.onDecision(c, ctx, instance, outcome),
    );
    // a merge of duplicate records decided at the last level, or withdrawn (0235)
    this.workflow.onComplete('student_merge', (c, ctx, instance, outcome) =>
      this.merges.onDecision(c, ctx, instance, outcome),
    );
    // an employee exit decided at the last level, or ended early (0237)
    this.workflow.onComplete('employee_exit', (c, ctx, instance, outcome) =>
      this.exits.onDecision(c, ctx, instance, outcome),
    );
    // a department's HOD changed: the vacancies waiting for approval follow at once (0201)
    this.masters.onChange('departments', (ctx) => this.approval.refresh(ctx));
  }
}
