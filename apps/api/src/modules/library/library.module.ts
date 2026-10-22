import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { FeesModule } from '../fees/fees.module';
import { LibraryBooksController } from './library-books.controller';
import { LibraryBooksService } from './library-books.service';
import { LibraryExportService } from './library-export.service';
import { LibraryImportService } from './library-import.service';
import { LibraryLabelsService } from './library-labels.service';
import { LibraryPeriodicalsService } from './library-periodicals.service';
import { LibraryRegisterService } from './library-register.service';
import { LibraryAccessionService } from './library-accession.service';
import { LibraryBooksUpdateService } from './library-books-update.service';
import { LibraryChargesService } from './library-charges.service';
import { LibraryDeskService } from './library-desk.service';
import { LibraryFinesService } from './library-fines.service';
import { LibraryHistoryService } from './library-history.service';
import { LibraryStockService } from './library-stock.service';
import { LibrarySalesService } from './library-sales.service';
import { LibraryStaffService } from './library-staff.service';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** Sprint 17: library (accession, circulation, fines). Sprint 18: sale, digital library, stock verification. */
@Module({
  imports: [DailyAcademicsModule, FeesModule],
  controllers: [LibraryController, LibraryBooksController],
  providers: [
    LibraryService,
    LibraryBooksService,
    LibraryExportService,
    LibraryImportService,
    LibraryLabelsService,
    LibraryPeriodicalsService,
    LibraryRegisterService,
    LibraryAccessionService,
    LibraryBooksUpdateService,
    LibraryChargesService,
    LibraryDeskService,
    LibraryFinesService,
    LibraryHistoryService,
    LibraryStockService,
    LibrarySalesService,
    LibraryStaffService,
    AuditService,
  ],
  exports: [LibraryService],
})
export class LibraryModule {}
