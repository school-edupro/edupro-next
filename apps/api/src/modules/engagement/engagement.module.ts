import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { CommsModule } from '../comms/comms.module';
import { EngagementController } from './engagement.controller';
import { FamilyService } from './family.service';
import { QueriesService } from './queries.service';

/** Sprint 10: parent queries, complaints and leave requests; feedback; profile change requests; family view. */
@Module({
  imports: [DailyAcademicsModule, CommsModule],
  controllers: [EngagementController],
  providers: [QueriesService, FamilyService, AuditService],
  exports: [QueriesService, FamilyService],
})
export class EngagementModule {}
