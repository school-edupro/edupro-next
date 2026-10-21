import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { LibraryBooksController } from './library-books.controller';
import { LibraryBooksService } from './library-books.service';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** Sprint 17: library (accession, circulation, fines). Sprint 18: sale, digital library, stock verification. */
@Module({
  imports: [DailyAcademicsModule],
  controllers: [LibraryController, LibraryBooksController],
  providers: [LibraryService, LibraryBooksService, AuditService],
  exports: [LibraryService],
})
export class LibraryModule {}
