import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { FeesModule } from '../../fees/fees.module';
import { TemplatesModule } from '../../platform/templates/templates.module';
import { ReportsModule } from '../../reports/reports.module';
import { LifecycleController } from './lifecycle.controller';
import { PromotionsService } from './promotions.service';
import { TcService } from './tc.service';
import { WithdrawalsService } from './withdrawals.service';

/** Transfer certificates, withdrawal clearance by configured departments, promotion decisions. */
@Module({
  imports: [ReportsModule, TemplatesModule, FeesModule],
  controllers: [LifecycleController],
  providers: [TcService, WithdrawalsService, PromotionsService, AuditService],
  exports: [TcService, WithdrawalsService, PromotionsService],
})
export class LifecycleModule {}
