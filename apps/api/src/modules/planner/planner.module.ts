import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DailyAcademicsModule } from '../academics/daily/daily.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowService } from '../workflow/workflow.service';
import { LessonPlansService } from './lesson-plans.service';
import {
  LessonPlansController,
  SubstitutionsController,
  SyllabusController,
} from './planner.controller';
import { SyllabusService } from './syllabus.service';
import { SubstitutionsService } from './substitutions.service';

/** Sprint 11: lesson planner with L1–L3 approvals and timetable substitutions with conflict checks. */
@Module({
  imports: [DailyAcademicsModule, WorkflowModule],
  controllers: [LessonPlansController, SubstitutionsController, SyllabusController],
  providers: [LessonPlansService, SubstitutionsService, SyllabusService, AuditService],
  exports: [LessonPlansService, SubstitutionsService],
})
export class PlannerModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly plans: LessonPlansService,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('lesson_plan', (c, ctx, instance, outcome) =>
      this.plans.onDecision(c, ctx, instance, outcome),
    );
  }
}
