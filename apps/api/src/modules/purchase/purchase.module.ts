import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { PurchaseIndentsService } from './purchase-indents.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseSetupService } from './purchase-setup.service';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { PurchaseController } from './purchase.controller';

/** Purchase (docs/design/83): the masters and vendors (part 1), indents (part 2), requisitions (part 3). */
@Module({
  imports: [WorkflowModule],
  controllers: [PurchaseController, PurchaseRequisitionsController],
  providers: [
    AuditService,
    PurchaseVendorsService,
    PurchaseSetupService,
    PurchaseIndentsService,
    PurchaseRequisitionsService,
  ],
})
export class PurchaseModule {}
