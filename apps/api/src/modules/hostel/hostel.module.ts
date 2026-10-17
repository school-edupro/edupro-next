import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { HostelController } from './hostel.controller';
import { HostelLifeController } from './hostel-life.controller';
import { HostelLifeService } from './hostel-life.service';
import { HostelH3Controller } from './hostel-h3.controller';
import { HostelMessService } from './hostel-mess.service';
import { HostelMessController } from './hostel-mess.controller';
import { HostelDietsService } from './hostel-diets.service';
import { HostelMealReportsService } from './hostel-meal-reports.service';
import { HostelVisitsService } from './hostel-visits.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { EngagementModule } from '../engagement/engagement.module';
import { HostelCareController } from './hostel-care.controller';
import { HostelCareService } from './hostel-care.service';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';
import { HostelWithdrawalController } from './hostel-withdrawal.controller';
import { HostelExitController } from './hostel-exit.controller';
import { HostelExitService } from './hostel-exit.service';
import { HostelFamilyService } from './hostel-family.service';
import { HostelReportsController } from './hostel-reports.controller';
import { HostelReportsService } from './hostel-reports.service';
import { HostelWithdrawalsService } from './hostel-withdrawals.service';
import { FeesModule } from '../fees/fees.module';
import { LifecycleModule } from '../people/lifecycle/lifecycle.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { HW_FLOW } from './hostel-withdrawals.service';

/** Hostel module (docs/design/25-hostel-module.md): set-up, wardens, bed allotment and occupancy. */
@Module({
  imports: [DailyAcademicsModule, EngagementModule, FeesModule, LifecycleModule, WorkflowModule],
  controllers: [
    HostelController,
    HostelLifeController,
    HostelH3Controller,
    HostelMessController,
    HostelCareController,
    HostelWithdrawalController,
    HostelExitController,
    HostelReportsController,
  ],
  providers: [
    HostelService,
    HostelImportService,
    HostelLifeService,
    HostelVisitsService,
    HostelMessService,
    HostelDietsService,
    HostelMealReportsService,
    HostelCareService,
    HostelWithdrawalsService,
    HostelExitService,
    HostelFamilyService,
    HostelReportsService,
    AuditService,
  ],
  exports: [HostelService],
})
export class HostelModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly hw: HostelWithdrawalsService,
  ) {}

  onModuleInit(): void {
    // a hostel withdrawal rides its own approval levels (Fee setup -> Approval levels)
    this.workflow.onComplete(HW_FLOW.entityType, (c, ctx, instance, outcome) =>
      this.hw.onApprovalComplete(c, ctx, instance, outcome),
    );
  }
}
