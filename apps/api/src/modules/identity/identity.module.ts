import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';

@Global()
@Module({
  controllers: [OtpController, MobileAuthController],
  providers: [IdentityService, OtpService, MobileAuthService],
  exports: [IdentityService, OtpService, MobileAuthService],
})
export class IdentityModule {}
