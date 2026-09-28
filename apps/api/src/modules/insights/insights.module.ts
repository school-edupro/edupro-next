import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DepartmentsService } from './departments.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

/** Sprint 12 (AI track): marts v1 and the principal dashboard; the query catalogue and assistant arrive in Sprint 14. */
@Module({
  controllers: [InsightsController],
  providers: [InsightsService, DepartmentsService, AuditService],
  exports: [InsightsService, DepartmentsService],
})
export class InsightsModule {}
