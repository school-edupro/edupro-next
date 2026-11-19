import { Module } from '@nestjs/common';
import { InternalCalls } from '../../common/http/internal-calls';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, InternalCalls],
})
export class ApprovalsModule {}
