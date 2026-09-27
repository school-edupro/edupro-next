import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FleetService } from './fleet.service';
import { FleetController, TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/** Sprint 10: routes and student assignments; Sprint 12: stops with geo, vehicles and drivers. */
@Module({
  controllers: [TransportController, FleetController],
  providers: [TransportService, FleetService, AuditService],
  exports: [TransportService, FleetService],
})
export class TransportModule {}
