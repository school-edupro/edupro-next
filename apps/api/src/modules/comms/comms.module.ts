import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CommsConsentsController,
  CommsDeliveryController,
  CommsGroupsController,
  CommsRequestsController,
  CommsWebhooksController,
} from './comms-engagement.controller';
import { CommsReportsService } from './comms-reports.service';
import { CommsSettingsService } from './comms-settings.service';
import { CommsInboxController, CommsSettingsController } from './comms-v2.controller';
import { InboxService } from './inbox.service';
import { CommsController } from './comms.controller';
import { ConsentsService } from './consents.service';
import { DeliveryService } from './delivery.service';
import { GroupsService } from './groups.service';
import { MessagesService } from './messages.service';
import { RequestsService } from './requests.service';
import { TemplatesService } from './templates.service';

/** S3 templates and delivery log; S10 message requests with approval, groups, consent and receipts. */
@Module({
  imports: [WorkflowModule, FilesModule],
  controllers: [
    CommsController,
    CommsRequestsController,
    CommsGroupsController,
    CommsConsentsController,
    CommsDeliveryController,
    CommsSettingsController,
    CommsWebhooksController,
    CommsInboxController,
  ],
  providers: [
    TemplatesService,
    MessagesService,
    RequestsService,
    GroupsService,
    ConsentsService,
    DeliveryService,
    CommsSettingsService,
    CommsReportsService,
    InboxService,
    AuditService,
  ],
  exports: [MessagesService, TemplatesService, ConsentsService, CommsSettingsService],
})
export class CommsModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly requests: RequestsService,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('message_request', (c, ctx, instance, outcome) =>
      this.requests.onDecision(c, ctx, instance, outcome),
    );
  }
}
