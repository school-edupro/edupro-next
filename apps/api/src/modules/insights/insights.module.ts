import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { EngagementModule } from '../engagement/engagement.module';
import { ReportsModule } from '../reports/reports.module';
import { AiModelController } from './ai-model.controller';
import { AiModelService } from './ai-model.service';
import { AiReportsService } from './ai-reports.service';
import { AlertsService } from './alerts.service';
import { AssistantService } from './assistant.service';
import { DepartmentsService } from './departments.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { MisService } from './mis.service';
import { NlqService } from './nlq/nlq.service';
import { ResultsAnalyticsService } from './results-analytics.service';

/** Sprint 12 (AI track): marts v1 and the principal dashboard; the query catalogue and assistant arrive in Sprint 14. */
@Module({
  imports: [DailyAcademicsModule, ReportsModule, EngagementModule],
  controllers: [InsightsController, AiModelController],
  providers: [
    AiModelService,
    InsightsService,
    DepartmentsService,
    AssistantService,
    AlertsService,
    AiReportsService,
    ResultsAnalyticsService,
    MisService,
    NlqService,
    AuditService,
  ],
  exports: [
    AiModelService,
    InsightsService,
    DepartmentsService,
    AssistantService,
    AlertsService,
    AiReportsService,
  ],
})
export class InsightsModule {}
