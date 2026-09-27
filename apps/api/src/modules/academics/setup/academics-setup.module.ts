import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { TeacherAssignmentsController } from './teacher-assignments.controller';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

/** Sprint 6: subjects, teacher assignments (drive RBAC scopes) and the timetable. */
@Module({
  controllers: [SubjectsController, TeacherAssignmentsController, TimetableController],
  providers: [SubjectsService, TeacherAssignmentsService, TimetableService, AuditService],
  exports: [SubjectsService, TeacherAssignmentsService, TimetableService],
})
export class AcademicsSetupModule {}
