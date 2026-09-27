import { Global, Module } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { SecurityEventsService } from './security-events.service';

@Global()
@Module({
  providers: [MetricsService, SecurityEventsService],
  exports: [MetricsService, SecurityEventsService],
})
export class SecurityModule {}
