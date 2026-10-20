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
import { CandidateAuthService } from './candidate-auth.service';
import { CandidateGuard } from './candidate.guard';
import { RecruitmentPublicController } from './recruitment-public.controller';
import { RecruitmentPublicService } from './recruitment-public.service';
import { WorkflowService } from '../workflow/workflow.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { StudentBulkService } from './student-bulk.service';
import { StudentGridService } from './student-grid.service';
import { StudentProfileController } from './student-profile.controller';
import { StudentProfileService } from './student-profile.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [FilesModule, ReportsModule, WorkflowModule, AdmissionsModule],
  controllers: [
    EmployeeSelfController,
    PeopleDashboardController,
    AcrController,
    RecruitmentController,
    RecruitmentPublicController,
    EmployeeProfileController,
    EmployeeTransferController,
    SectionRollController,
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
    RecruitmentPublicService,
    CandidateAuthService,
    CandidateGuard,
    EmployeeProfileService,
    EmployeeGridService,
    EmployeeBulkService,
    EmployeeTransferService,
    SectionRollService,
    StudentBulkService,
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
  ) {}

  onModuleInit() {
    // a vacancy's approval decided at the last level (0197)
    this.workflow.onComplete('vacancy', (c, ctx, instance, outcome) =>
      this.recruitment.onDecision(c, ctx, instance, outcome),
    );
  }
}
