import { Module } from '@nestjs/common';
import { InternalCalls } from '../../common/http/internal-calls';
import { FilesModule } from '../files/files.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [FilesModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, InternalCalls],
})
export class ApprovalsModule {}
