import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

/** Sprint 14: exam masters. Marks entry, registers and report cards follow in Sprints 15 to 18. */
@Module({
  controllers: [ExamsController],
  providers: [ExamsService, AuditService],
  exports: [ExamsService],
})
export class ExamsModule {}
