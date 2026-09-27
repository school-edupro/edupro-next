import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [FilesModule],
  controllers: [ReportsController],
  providers: [ReportsService, AuditService],
  exports: [ReportsService],
})
export class ReportsModule {}
