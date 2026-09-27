import { Module } from '@nestjs/common';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CacheModule } from '../../common/cache/cache.module';
import { PlatformModule } from '../platform/platform.module';
import { CompatReadsController } from './compat-reads.controller';
import { CompatReadsService } from './compat-reads.service';
import { CompatWritesController } from './compat-writes.controller';
import { CompatWritesService } from './compat-writes.service';
import { CompatController } from './compat.controller';
import { CompatService } from './compat.service';

/** S4 handshake, S5 reads, S11 teacher-app writes (homework, attendance, notices). */
@Module({
  imports: [CacheModule, PlatformModule, DailyAcademicsModule, AttendanceModule],
  controllers: [CompatController, CompatReadsController, CompatWritesController],
  providers: [CompatService, CompatReadsService, CompatWritesService],
  exports: [CompatService],
})
export class CompatModule {}
