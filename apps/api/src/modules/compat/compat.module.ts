import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CompatReadsController } from './compat-reads.controller';
import { CompatReadsService } from './compat-reads.service';
import { CompatController } from './compat.controller';
import { CompatService } from './compat.service';

@Module({
  imports: [PlatformModule],
  controllers: [CompatController, CompatReadsController],
  providers: [CompatService, CompatReadsService],
  exports: [CompatService],
})
export class CompatModule {}
