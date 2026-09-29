import { Module } from '@nestjs/common';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CacheModule } from '../../common/cache/cache.module';
import { PlatformModule } from '../platform/platform.module';
import { CompatReadsController } from './compat-reads.controller';
import { CompatReadsService } from './compat-reads.service';
import { CompatWritesController } from './compat-writes.controller';
import { CompatWritesService } from './compat-writes.service';
import { EngagementModule } from '../engagement/engagement.module';
import { ExamsModule } from '../exams/exams.module';
import { FeesModule } from '../fees/fees.module';
import { FilesModule } from '../files/files.module';
import { LibraryModule } from '../library/library.module';
import { CompatParityController } from './compat-parity.controller';
import { CompatParityService } from './compat-parity.service';
import { CompatController } from './compat.controller';
import { CompatService } from './compat.service';

/** S4 handshake, S5 reads, S11 teacher-app writes (homework, attendance, notices), S20 parity endpoints. */
@Module({
  imports: [
    CacheModule,
    PlatformModule,
    DailyAcademicsModule,
    AttendanceModule,
    FeesModule,
    LibraryModule,
    ExamsModule,
    EngagementModule,
    FilesModule,
  ],
  controllers: [
    CompatController,
    CompatReadsController,
    CompatWritesController,
    CompatParityController,
  ],
  providers: [CompatService, CompatReadsService, CompatWritesService, CompatParityService],
  exports: [CompatService],
})
export class CompatModule {}
