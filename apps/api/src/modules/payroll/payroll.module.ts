import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PayrollController } from './payroll.controller';
import { PayrollHeadsService } from './payroll-heads.service';
import { PayrollPeopleService } from './payroll-people.service';
import { PayrollSetupService } from './payroll-setup.service';

/** Payroll (docs/design/86). Phase A: the set-up. The calculation is @edupro/payroll-engine. */
@Module({
  controllers: [PayrollController],
  providers: [PayrollSetupService, PayrollHeadsService, PayrollPeopleService, AuditService],
  exports: [PayrollSetupService],
})
export class PayrollModule {}
