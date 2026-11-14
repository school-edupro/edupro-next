import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AuditService } from '../../common/audit/audit.service';
import { PayrollAttendanceService } from './payroll-attendance.service';
import { PayrollInputsController } from './payroll-inputs.controller';
import { PayrollItemsService } from './payroll-items.service';
import { PayrollBankController } from './payroll-bank.controller';
import { PayrollBankService } from './payroll-bank.service';
import { PayrollStatutoryController } from './payroll-statutory.controller';
import { PayrollStatutoryService } from './payroll-statutory.service';
import { PayrollPayslipController } from './payroll-payslip.controller';
import { PayrollPayslipService } from './payroll-payslip.service';
import { PayrollReviewController } from './payroll-review.controller';
import { PayrollReviewService } from './payroll-review.service';
import { PayrollRunController } from './payroll-run.controller';
import { PayrollRunService } from './payroll-run.service';
import { PayrollController } from './payroll.controller';
import { PayrollHeadsService } from './payroll-heads.service';
import { PayrollPeopleService } from './payroll-people.service';
import { PayrollSetupService } from './payroll-setup.service';

/**
 * Payroll (docs/design/86). Phase A: the set-up; phase B: the monthly inputs, the run, review and payslips. The
 * calculation is @edupro/payroll-engine.
 */
@Module({
  imports: [FilesModule],
  controllers: [
    PayrollController,
    PayrollInputsController,
    PayrollRunController,
    PayrollReviewController,
    PayrollPayslipController,
    PayrollBankController,
    PayrollStatutoryController,
  ],
  providers: [
    PayrollSetupService,
    PayrollHeadsService,
    PayrollPeopleService,
    PayrollAttendanceService,
    PayrollItemsService,
    PayrollRunService,
    PayrollReviewService,
    PayrollPayslipService,
    PayrollBankService,
    PayrollStatutoryService,
    AuditService,
  ],
  exports: [PayrollSetupService],
})
export class PayrollModule {}
