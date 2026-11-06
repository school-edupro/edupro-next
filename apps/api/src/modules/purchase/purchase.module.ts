import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { PurchaseIndentsService } from './purchase-indents.service';
import { PurchaseSetupService } from './purchase-setup.service';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { PurchaseController } from './purchase.controller';

/** Purchase (docs/design/83): part 1 — the masters, vendors with maker-checker, settings, approvals. */
@Module({
  imports: [WorkflowModule],
  controllers: [PurchaseController],
  providers: [AuditService, PurchaseVendorsService, PurchaseSetupService, PurchaseIndentsService],
})
export class PurchaseModule {}
