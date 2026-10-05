import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { ShadowModule } from '../shadow/shadow.module';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { FleetService } from './fleet.service';
import { TransportDeskService } from './transport-desk.service';
import { TransportOpsService } from './transport-ops.service';
import { TransportRequestsService } from './transport-requests.service';
import {
  FleetController,
  TransportDeskController,
  TransportReplacementsController,
  TransportController,
  TransportRequestsController,
} from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Sprint 10: routes and student assignments; Sprint 12: stops with geo, vehicles and drivers; Sprint 13:
 * vehicle logs; transport v2: the request desk with its own approval levels, history and fee update.
 */
@Module({
  imports: [DailyAcademicsModule, ShadowModule],
  controllers: [
    TransportController,
    FleetController,
    TransportRequestsController,
    TransportDeskController,
    TransportReplacementsController,
    GpsController,
  ],
  providers: [
    TransportService,
    FleetService,
    TransportRequestsService,
    TransportDeskService,
    TransportOpsService,
    GpsService,
    AuditService,
  ],
  exports: [TransportService, FleetService, TransportRequestsService],
})
export class TransportModule {}
