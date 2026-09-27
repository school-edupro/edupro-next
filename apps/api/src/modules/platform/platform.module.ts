import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { SchoolService } from './school.service';
import { SettingsService } from './settings.service';
import { YearsService } from './years.service';

@Module({
  controllers: [PlatformController],
  providers: [SettingsService, YearsService, SchoolService],
  exports: [SettingsService, YearsService, SchoolService],
})
export class PlatformModule {}
