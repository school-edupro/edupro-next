import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { FilesModule } from '../files/files.module';
import { ReportsModule } from '../reports/reports.module';
import { ReportCardSignaturesService } from './report-card-signatures.service';
import { BoardResultsController } from './board-results.controller';
import { BoardResultsService } from './board-results.service';
import { ExamAnalysisController } from './exam-analysis.controller';
import { ExamAnalysisService } from './exam-analysis.service';
import { ExamDateSheetsController } from './exam-date-sheets.controller';
import { ExamDateSheetsService } from './exam-date-sheets.service';
import { ExamEntryController } from './exam-entry.controller';
import { ExamRemarksController } from './exam-remarks.controller';
import { RemarkCategoriesService } from './remark-categories.service';
import { SchemePromotionService } from './scheme-promotion.service';
import { ExamEntryService } from './exam-entry.service';
import { ExamResultsService } from './exam-results.service';
import { ExamStatusController } from './exam-status.controller';
import { StudentRegistersController } from './student-registers.controller';
import { StudentRegistersService } from './student-registers.service';
import { MarkSchemesController } from './mark-schemes.controller';
import { MarkSchemesService } from './mark-schemes.service';
import { ExamStatusService } from './exam-status.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { FamilyHpcController, HpcController } from './hpc.controller';
import { HpcService } from './hpc.service';
import { IndicatorMastersController } from './indicator-masters.controller';
import { IndicatorMastersService } from './indicator-masters.service';
import { FamilyResultsController, ReportCardsController } from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';
import { SubjectChoicesController } from './subject-choices.controller';
import { SubjectChoicesService } from './subject-choices.service';

/**
 * Sprint 14: exam masters. Sprint 15: entry (marks, indicators, remarks, attendance, health).
 * Sprint 16: results. Sprint 17: report cards (templates, releases, batch render, family read).
 */
@Module({
  imports: [DailyAcademicsModule, ReportsModule, FilesModule],
  controllers: [
    ExamDateSheetsController,
    SubjectChoicesController,
    ExamStatusController,
    MarkSchemesController,
    StudentRegistersController,
    HpcController,
    IndicatorMastersController,
    FamilyHpcController,
    ExamAnalysisController,
    ExamRemarksController,
    ExamsController,
    ExamEntryController,
    ReportCardsController,
    FamilyResultsController,
    BoardResultsController,
  ],
  providers: [
    ExamsService,
    ExamDateSheetsService,
    ExamEntryService,
    ExamResultsService,
    ReportCardsService,
    BoardResultsService,
    SubjectChoicesService,
    ExamStatusService,
    MarkSchemesService,
    ReportCardSignaturesService,
    HpcService,
    IndicatorMastersService,
    ExamAnalysisService,
    RemarkCategoriesService,
    SchemePromotionService,
    AuditService,
    StudentRegistersService,
  ],
  exports: [ExamsService, ExamEntryService, ExamResultsService, ReportCardsService],
})
export class ExamsModule {}
