import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { PurchaseIndentsService } from './purchase-indents.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseAssetsController } from './purchase-assets.controller';
import { PurchaseAssetsService } from './purchase-assets.service';
import { PurchaseCondemnationsService } from './purchase-condemnations.service';
import { PurchaseCountsService } from './purchase-counts.service';
import { PurchaseIssuesService } from './purchase-issues.service';
import { PurchaseReceiptsController } from './purchase-receipts.controller';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseStockController } from './purchase-stock.controller';
import { PurchaseTransfersService } from './purchase-transfers.service';
import { PurchaseReorderService } from './purchase-reorder.service';
import { PurchaseReportsController } from './purchase-reports.controller';
import { PurchaseReportsService } from './purchase-reports.service';
import { PurchaseStoresController } from './purchase-stores.controller';
import { PurchaseStoresService } from './purchase-stores.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseSetupService } from './purchase-setup.service';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { PurchaseController } from './purchase.controller';

/** Purchase (docs/design/83): masters and vendors (1), indents (2), requisitions (3), orders (4), reports (5); phase 2 stores and stock (6), receipts (7), issues, returns, transfers, counts (8), reorder, assets, condemnation (9) (doc 84). */
@Module({
  imports: [WorkflowModule, FilesModule],
  controllers: [
    PurchaseController,
    PurchaseRequisitionsController,
    PurchaseOrdersController,
    PurchaseReportsController,
    PurchaseStoresController,
    PurchaseReceiptsController,
    PurchaseStockController,
    PurchaseAssetsController,
  ],
  providers: [
    AuditService,
    PurchaseVendorsService,
    PurchaseSetupService,
    PurchaseIndentsService,
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    PurchaseReportsService,
    PurchaseStoresService,
    PurchaseReceiptsService,
    PurchaseIssuesService,
    PurchaseReturnsService,
    PurchaseTransfersService,
    PurchaseCountsService,
    PurchaseAssetsService,
    PurchaseCondemnationsService,
    PurchaseReorderService,
  ],
})
export class PurchaseModule {}
