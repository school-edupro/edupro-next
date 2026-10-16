import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { HostelController } from './hostel.controller';
import { HostelLifeController } from './hostel-life.controller';
import { HostelLifeService } from './hostel-life.service';
import { HostelH3Controller } from './hostel-h3.controller';
import { HostelMessService } from './hostel-mess.service';
import { HostelVisitsService } from './hostel-visits.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { EngagementModule } from '../engagement/engagement.module';
import { HostelCareController } from './hostel-care.controller';
import { HostelCareService } from './hostel-care.service';
import { HostelImportService } from './hostel-import.service';
import { HostelService } from './hostel.service';
import { HostelWithdrawalController } from './hostel-withdrawal.controller';
import { HostelWithdrawalsService } from './hostel-withdrawals.service';
import { FeesModule } from '../fees/fees.module';
import { LifecycleModule } from '../people/lifecycle/lifecycle.module';
import { WorkflowModule } from '../workflow/workflow.module';

/** Hostel module (docs/design/25-hostel-module.md): set-up, wardens, bed allotment and occupancy. */
@Module({
  imports: [DailyAcademicsModule, EngagementModule, FeesModule, LifecycleModule, WorkflowModule],
  controllers: [
    HostelController,
    HostelLifeController,
    HostelH3Controller,
    HostelCareController,
    HostelWithdrawalController,
  ],
  providers: [
    HostelService,
    HostelImportService,
    HostelLifeService,
    HostelVisitsService,
    HostelMessService,
    HostelCareService,
    HostelWithdrawalsService,
    AuditService,
  ],
  exports: [HostelService],
})
export class HostelModule {}
