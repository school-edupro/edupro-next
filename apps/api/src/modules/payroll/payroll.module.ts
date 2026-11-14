import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AuditService } from '../../common/audit/audit.service';
import { PayrollAttendanceService } from './payroll-attendance.service';
import { PayrollInputsController } from './payroll-inputs.controller';
import { PayrollItemsService } from './payroll-items.service';
import { PayrollAccountsController } from './payroll-accounts.controller';
import { PayrollAccountsService } from './payroll-accounts.service';
import { PayrollBankController } from './payroll-bank.controller';
import { PayrollBankService } from './payroll-bank.service';
import { PayrollTaxDocsController } from './payroll-tax-docs.controller';
import { PayrollTaxDocsService } from './payroll-tax-docs.service';
import { PayrollTaxController } from './payroll-tax.controller';
import { PayrollTaxService } from './payroll-tax.service';
import { PayrollStatutoryController } from './payroll-statutory.controller';
import { PayrollStatutoryService } from './payroll-statutory.service';
import { PayrollPayslipController } from './payroll-payslip.controller';
import { PayrollPayslipService } from './payroll-payslip.service';
import { PayrollReviewController } from './payroll-review.controller';
import { PayrollReviewService } from './payroll-review.service';
import { PayrollRevisionController } from './payroll-revision.controller';
import { PayrollRevisionService } from './payroll-revision.service';
import { PayrollPeopleDocsController } from './payroll-people-docs.controller';
import { PayrollPeopleDocsService } from './payroll-people-docs.service';
import { PayrollSettlementController } from './payroll-settlement.controller';
import { PayrollSettlementService } from './payroll-settlement.service';
import { PayrollTransferService } from './payroll-transfer.service';
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
    PayrollAccountsController,
    PayrollTaxController,
    PayrollTaxDocsController,
    PayrollRevisionController,
    PayrollSettlementController,
    PayrollPeopleDocsController,
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
    PayrollAccountsService,
    PayrollTaxService,
    PayrollTaxDocsService,
    PayrollRevisionService,
    PayrollSettlementService,
    PayrollPeopleDocsService,
    PayrollTransferService,
    AuditService,
  ],
  exports: [PayrollSetupService],
})
export class PayrollModule {}
