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
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [FilesModule, ReportsModule],
  controllers: [StudentsController, EmployeesController, SearchController, ImportsController],
  providers: [StudentsService, EmployeesService, SearchService, ImportsService, AuditService],
  exports: [StudentsService, EmployeesService],
})
export class PeopleModule {}
