import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { ReportsModule } from '../reports/reports.module';
import { ExamEntryController } from './exam-entry.controller';
import { ExamEntryService } from './exam-entry.service';
import { ExamResultsService } from './exam-results.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { FamilyResultsController, ReportCardsController } from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';

/**
 * Sprint 14: exam masters. Sprint 15: entry (marks, indicators, remarks, attendance, health).
 * Sprint 16: results. Sprint 17: report cards (templates, releases, batch render, family read).
 */
@Module({
  imports: [DailyAcademicsModule, ReportsModule],
  controllers: [
    ExamsController,
    ExamEntryController,
    ReportCardsController,
    FamilyResultsController,
  ],
  providers: [ExamsService, ExamEntryService, ExamResultsService, ReportCardsService, AuditService],
  exports: [ExamsService, ExamEntryService, ExamResultsService, ReportCardsService],
})
export class ExamsModule {}
