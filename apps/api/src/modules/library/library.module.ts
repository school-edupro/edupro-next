import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { LibraryBooksController } from './library-books.controller';
import { LibraryBooksService } from './library-books.service';
import { LibraryExportService } from './library-export.service';
import { LibraryImportService } from './library-import.service';
import { LibraryLabelsService } from './library-labels.service';
import { LibraryPeriodicalsService } from './library-periodicals.service';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** Sprint 17: library (accession, circulation, fines). Sprint 18: sale, digital library, stock verification. */
@Module({
  imports: [DailyAcademicsModule],
  controllers: [LibraryController, LibraryBooksController],
  providers: [
    LibraryService,
    LibraryBooksService,
    LibraryExportService,
    LibraryImportService,
    LibraryLabelsService,
    LibraryPeriodicalsService,
    AuditService,
  ],
  exports: [LibraryService],
})
export class LibraryModule {}
