import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CommsConsentsController,
  CommsDeliveryController,
  CommsGroupsController,
  CommsRequestsController,
} from './comms-engagement.controller';
import { CommsController } from './comms.controller';
import { ConsentsService } from './consents.service';
import { DeliveryService } from './delivery.service';
import { GroupsService } from './groups.service';
import { MessagesService } from './messages.service';
import { RequestsService } from './requests.service';
import { TemplatesService } from './templates.service';

/** S3 templates and delivery log; S10 message requests with approval, groups, consent and receipts. */
@Module({
  imports: [WorkflowModule],
  controllers: [
    CommsController,
    CommsRequestsController,
    CommsGroupsController,
    CommsConsentsController,
    CommsDeliveryController,
  ],
  providers: [
    TemplatesService,
    MessagesService,
    RequestsService,
    GroupsService,
    ConsentsService,
    DeliveryService,
    AuditService,
  ],
  exports: [MessagesService, TemplatesService, ConsentsService],
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
