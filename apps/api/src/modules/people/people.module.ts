import { SectionRollController } from './section-roll.controller';
import { SectionRollService } from './section-roll.service';
import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { FilesModule } from '../files/files.module';
import { ReportsModule } from '../reports/reports.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { StudentBulkService } from './student-bulk.service';
import { StudentGridService } from './student-grid.service';
import { StudentProfileController } from './student-profile.controller';
import { StudentProfileService } from './student-profile.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [FilesModule, ReportsModule],
  controllers: [
    SectionRollController,
    StudentProfileController,
    StudentsController,
    EmployeesController,
    SearchController,
    ImportsController,
  ],
  providers: [
    SectionRollService,
    StudentBulkService,
    StudentGridService,
    StudentProfileService,
    StudentsService,
    EmployeesService,
    SearchService,
    ImportsService,
    AuditService,
  ],
  exports: [StudentsService, EmployeesService, StudentProfileService],
})
export class PeopleModule {}
