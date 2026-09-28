import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { MastersController } from './masters.controller';
import { MastersService } from './masters.service';

/** Master-data framework: one grid, upload, bulk update and clone for every registered master. */
@Module({
  controllers: [MastersController],
  providers: [MastersService, AuditService],
  exports: [MastersService],
})
export class MastersModule {}
