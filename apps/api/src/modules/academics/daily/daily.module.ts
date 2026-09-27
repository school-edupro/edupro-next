import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { FilesModule } from '../../files/files.module';
import { CalendarService } from './calendar.service';
import {
  CalendarController,
  DailyWorkController,
  GalleryController,
  NoticesController,
} from './daily.controller';
import { DailyWorkService } from './daily-work.service';
import { GalleryService } from './gallery.service';
import { NoticesService } from './notices.service';
import { ViewerService } from './viewer.service';

/** Sprint 7: homework, classwork, assignments, notices, holidays, almanac and gallery. */
@Module({
  imports: [FilesModule],
  controllers: [DailyWorkController, NoticesController, CalendarController, GalleryController],
  providers: [
    ViewerService,
    DailyWorkService,
    NoticesService,
    CalendarService,
    GalleryService,
    AuditService,
  ],
  exports: [ViewerService, CalendarService, DailyWorkService, NoticesService],
})
export class DailyAcademicsModule {}
