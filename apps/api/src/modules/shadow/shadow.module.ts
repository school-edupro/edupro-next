import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ServiceKeysService } from './service-keys.service';
import { ServiceKeysController, ShadowController } from './shadow.controller';
import { ShadowService } from './shadow.service';

/** Sprint 16: the shadow run and machine service keys. */
@Module({
  controllers: [ShadowController, ServiceKeysController],
  providers: [ShadowService, ServiceKeysService, AuditService],
  exports: [ShadowService, ServiceKeysService],
})
export class ShadowModule {}
