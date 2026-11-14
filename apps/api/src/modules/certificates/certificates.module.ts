import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FeesModule } from '../fees/fees.module';
import { FilesModule } from '../files/files.module';
import { ReportsModule } from '../reports/reports.module';
import { CertificateSetupController } from './certificate-setup.controller';
import { CertificateSetupService } from './certificate-setup.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/** Certificate management (docs/design/87): types, the register, numbering, checks, duplicates and cancels. */
@Module({
  imports: [ReportsModule, FeesModule, FilesModule],
  controllers: [CertificateSetupController, CertificatesController],
  providers: [CertificatesService, CertificateSetupService, AuditService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
