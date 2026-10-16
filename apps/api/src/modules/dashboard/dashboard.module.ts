import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CommsModule } from '../comms/comms.module';
import { InsightsModule } from '../insights/insights.module';
import { DashboardController } from './dashboard.controller';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { DashboardService } from './dashboard.service';

/** The admin landing page by role: layouts, role defaults, birthdays and wishes. */
@Module({
  imports: [CommsModule, InsightsModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardWidgetsService, AuditService],
})
export class DashboardModule {}
