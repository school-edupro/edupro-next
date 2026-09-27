import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FeeDemandsService } from './fee-demands.service';
import { FeeMastersService } from './fee-masters.service';
import { FeesController } from './fees.controller';

/** Sprint 8: fee engine start (masters, student profiles, demand generation). */
@Module({
  controllers: [FeesController],
  providers: [FeeMastersService, FeeDemandsService, AuditService],
  exports: [FeeMastersService, FeeDemandsService],
})
export class FeesModule {}
