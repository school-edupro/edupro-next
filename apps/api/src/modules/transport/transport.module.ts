import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/** Sprint 10: minimal routes and student assignments; Sprint 12 adds stops, geo, vehicles and slabs. */
@Module({
  controllers: [TransportController],
  providers: [TransportService, AuditService],
  exports: [TransportService],
})
export class TransportModule {}
