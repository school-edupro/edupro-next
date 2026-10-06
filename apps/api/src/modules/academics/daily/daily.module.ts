import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { CommsModule } from '../../comms/comms.module';
import { FilesModule } from '../../files/files.module';
import { CalendarService } from './calendar.service';
import {
  CalendarController,
  DailyWorkController,
  DocumentsController,
  GalleryController,
  NoticesController,
} from './daily.controller';
import { DailyWorkService } from './daily-work.service';
import { DocumentsService } from './documents.service';
import { GalleryService } from './gallery.service';
import { NoticesService } from './notices.service';
import { ViewerService } from './viewer.service';

/** Sprint 7: homework, classwork, assignments, notices, holidays, almanac and gallery. */
@Module({
  imports: [FilesModule, CommsModule],
  controllers: [
    DailyWorkController,
    NoticesController,
    CalendarController,
    GalleryController,
    DocumentsController,
  ],
  providers: [
    ViewerService,
    DailyWorkService,
    DocumentsService,
    NoticesService,
    CalendarService,
    GalleryService,
    AuditService,
  ],
  exports: [ViewerService, CalendarService, DailyWorkService, NoticesService, GalleryService],
})
export class DailyAcademicsModule {}
