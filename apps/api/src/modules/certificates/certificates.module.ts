import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CommsModule } from '../comms/comms.module';
import { FeesModule } from '../fees/fees.module';
import { FilesModule } from '../files/files.module';
import { ReportsModule } from '../reports/reports.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CertificateAwardsService } from './certificate-awards.service';
import { CertificateBulkService } from './certificate-bulk.service';
import { CertificateOfficeController } from './certificate-office.controller';
import { CertificateReportsService } from './certificate-reports.service';
import { CertificateRequestsController } from './certificate-requests.controller';
import { CertificateRequestsService } from './certificate-requests.service';
import { CertificateSetupController } from './certificate-setup.controller';
import { CertificateVerifyService } from './certificate-verify.service';
import { PublicCertificatesController } from './public-certificates.controller';
import { PublicThrottleGuard } from '../admissions/public/public-throttle.guard';
import { CertificateSetupService } from './certificate-setup.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/** Certificate management (docs/design/87): types, the register, numbering, checks, duplicates and cancels. */
@Module({
  imports: [ReportsModule, FeesModule, FilesModule, WorkflowModule, CommsModule],
  controllers: [
    CertificateSetupController,
    CertificateRequestsController,
    PublicCertificatesController,
    CertificateOfficeController,
    CertificatesController,
  ],
  providers: [
    CertificatesService,
    CertificateSetupService,
    CertificateRequestsService,
    CertificateVerifyService,
    CertificateBulkService,
    CertificateAwardsService,
    CertificateReportsService,
    PublicThrottleGuard,
    AuditService,
  ],
  exports: [CertificatesService],
})
export class CertificatesModule {}
