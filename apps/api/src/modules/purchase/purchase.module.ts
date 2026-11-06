import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { PurchaseIndentsService } from './purchase-indents.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReportsController } from './purchase-reports.controller';
import { PurchaseReportsService } from './purchase-reports.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseSetupService } from './purchase-setup.service';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { PurchaseController } from './purchase.controller';

/** Purchase (docs/design/83): masters and vendors (1), indents (2), requisitions (3), orders (4), reports (5). */
@Module({
  imports: [WorkflowModule, FilesModule],
  controllers: [
    PurchaseController,
    PurchaseRequisitionsController,
    PurchaseOrdersController,
    PurchaseReportsController,
  ],
  providers: [
    AuditService,
    PurchaseVendorsService,
    PurchaseSetupService,
    PurchaseIndentsService,
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    PurchaseReportsService,
  ],
})
export class PurchaseModule {}
