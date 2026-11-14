import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FeesModule } from '../fees/fees.module';
import { ReportsModule } from '../reports/reports.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/** Certificate management (docs/design/87): types, the register, numbering, checks, duplicates and cancels. */
@Module({
  imports: [ReportsModule, FeesModule],
  controllers: [CertificatesController],
  providers: [CertificatesService, AuditService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
