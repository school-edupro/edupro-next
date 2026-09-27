import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CompatController } from './compat.controller';
import { CompatService } from './compat.service';

@Module({
  imports: [PlatformModule],
  controllers: [CompatController],
  providers: [CompatService],
  exports: [CompatService],
})
export class CompatModule {}
