import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CommsController } from './comms.controller';
import { MessagesService } from './messages.service';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [CommsController],
  providers: [TemplatesService, MessagesService, AuditService],
  exports: [MessagesService, TemplatesService],
})
export class CommsModule {}
