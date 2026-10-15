import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';

@Global()
@Module({
  controllers: [OtpController],
  providers: [IdentityService, OtpService],
  exports: [IdentityService, OtpService],
})
export class IdentityModule {}
