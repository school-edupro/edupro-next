import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformModule } from '../platform/platform.module';
import { ReportsModule } from '../reports/reports.module';
import { MonthEndController, OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/** Sprints 22-23: pilot cut-over, hypercare, feature flags, month-end close. */
@Module({
  imports: [PlatformModule, ReportsModule],
  controllers: [OpsController, MonthEndController],
  providers: [OpsService, AuditService],
  exports: [OpsService],
})
export class OpsModule {}
