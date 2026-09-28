import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { TemplatesModule } from '../platform/templates/templates.module';
import { ReportsModule } from '../reports/reports.module';
import { FeeDemandsService } from './fee-demands.service';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeMastersService } from './fee-masters.service';
import { FeesController } from './fees.controller';

/** Sprint 8: fee engine start (masters, student profiles, demand generation); Sprint 12: ledger, late fee, receipts. */
@Module({
  imports: [ReportsModule, TemplatesModule, DailyAcademicsModule],
  controllers: [FeesController],
  providers: [FeeMastersService, FeeDemandsService, FeeLedgerService, AuditService],
  exports: [FeeMastersService, FeeDemandsService, FeeLedgerService],
})
export class FeesModule {}
