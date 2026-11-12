import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PayrollAttendanceService } from './payroll-attendance.service';
import { PayrollInputsController } from './payroll-inputs.controller';
import { PayrollItemsService } from './payroll-items.service';
import { PayrollController } from './payroll.controller';
import { PayrollHeadsService } from './payroll-heads.service';
import { PayrollPeopleService } from './payroll-people.service';
import { PayrollSetupService } from './payroll-setup.service';

/** Payroll (docs/design/86). Phase A: the set-up; phase B: the monthly inputs. The calculation is @edupro/payroll-engine. */
@Module({
  controllers: [PayrollController, PayrollInputsController],
  providers: [
    PayrollSetupService,
    PayrollHeadsService,
    PayrollPeopleService,
    PayrollAttendanceService,
    PayrollItemsService,
    AuditService,
  ],
  exports: [PayrollSetupService],
})
export class PayrollModule {}
