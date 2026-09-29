import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [FilesModule],
  controllers: [ReportsController, SchedulesController],
  providers: [ReportsService, SchedulesService, AuditService],
  exports: [ReportsService, SchedulesService],
})
export class ReportsModule {}
