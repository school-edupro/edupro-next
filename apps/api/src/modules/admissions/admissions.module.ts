import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { ApplicantGuard } from './public/applicant.guard';
import { OtpService } from './public/otp.service';
import { PowService } from './public/pow.service';
import { PublicAdmissionsController } from './public/public-admissions.controller';
import { PublicAdmissionsService } from './public/public-admissions.service';
import { PublicThrottleGuard } from './public/public-throttle.guard';

/** Sprint 8: admission cycles, intake desk and the public applicant surface. */
@Module({
  controllers: [AdmissionsController, PublicAdmissionsController],
  providers: [
    AdmissionsService,
    PublicAdmissionsService,
    PowService,
    OtpService,
    ApplicantGuard,
    PublicThrottleGuard,
    AuditService,
  ],
  exports: [AdmissionsService, PublicAdmissionsService],
})
export class AdmissionsModule {}
