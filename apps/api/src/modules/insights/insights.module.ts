import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { ReportsModule } from '../reports/reports.module';
import { AiReportsService } from './ai-reports.service';
import { AlertsService } from './alerts.service';
import { AssistantService } from './assistant.service';
import { DepartmentsService } from './departments.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { ResultsAnalyticsService } from './results-analytics.service';

/** Sprint 12 (AI track): marts v1 and the principal dashboard; the query catalogue and assistant arrive in Sprint 14. */
@Module({
  imports: [DailyAcademicsModule, ReportsModule],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    DepartmentsService,
    AssistantService,
    AlertsService,
    AiReportsService,
    ResultsAnalyticsService,
    AuditService,
  ],
  exports: [InsightsService, DepartmentsService, AssistantService, AlertsService, AiReportsService],
})
export class InsightsModule {}
