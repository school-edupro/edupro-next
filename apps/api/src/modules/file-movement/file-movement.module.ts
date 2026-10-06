import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { FileMovementController } from './file-movement.controller';
import { FileMovementService } from './file-movement.service';

/** Digital file movement: approval notes that move through the approvers their creator chose. */
@Module({
  imports: [FilesModule],
  controllers: [FileMovementController],
  providers: [FileMovementService, AuditService],
})
export class FileMovementModule {}
