import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';

@Global()
@Module({
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
