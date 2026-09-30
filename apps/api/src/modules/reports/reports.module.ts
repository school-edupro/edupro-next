import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { ReportBuilderController } from './report-builder.controller';
import { ReportBuilderService } from './report-builder.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [FilesModule],
  controllers: [ReportsController, SchedulesController, ReportBuilderController],
  providers: [ReportsService, SchedulesService, ReportBuilderService, AuditService],
  exports: [ReportsService, SchedulesService],
})
export class ReportsModule {}
