import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { WebHopController } from './web-hop.controller';
import { WebHopService } from './web-hop.service';

@Global()
@Module({
  controllers: [OtpController, MobileAuthController, WebHopController],
  providers: [IdentityService, OtpService, MobileAuthService, WebHopService],
  exports: [IdentityService, OtpService, MobileAuthService],
})
export class IdentityModule {}
