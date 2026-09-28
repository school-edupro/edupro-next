import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ExamEntryController } from './exam-entry.controller';
import { ExamEntryService } from './exam-entry.service';
import { ExamResultsService } from './exam-results.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

/** Sprint 14: exam masters. Sprint 15: entry (marks, indicators, remarks, attendance, health). */
@Module({
  controllers: [ExamsController, ExamEntryController],
  providers: [ExamsService, ExamEntryService, ExamResultsService, AuditService],
  exports: [ExamsService, ExamEntryService, ExamResultsService],
})
export class ExamsModule {}
