import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { ReportsModule } from '../../reports/reports.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [ReportsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, AuditService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
