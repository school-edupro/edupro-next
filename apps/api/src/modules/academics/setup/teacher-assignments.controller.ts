import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { CreateTeacherAssignmentDto, ListTeacherAssignmentsQueryDto } from './academics.dto';
import { ACADEMICS } from './academics.permissions';
import { TeacherAssignmentsService } from './teacher-assignments.service';

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly assignments: TeacherAssignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Teacher assignments of the working year (scoped for teachers)' })
  @RequirePermission(ACADEMICS.assignmentView, {
    description: 'View teacher assignments (scope: class_section)',
  })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListTeacherAssignmentsQueryDto) {
    return { data: await this.assignments.list(ctx, q) };
  }

  @Get('mine')
  @ApiOperation({ summary: 'My own assignments (teacher app)' })
  @RequirePermission(ACADEMICS.assignmentView)
  async mine(@ReqCtx() ctx: RequestContext) {
    return { data: await this.assignments.mine(ctx) };
  }

  @Post()
  @ApiOperation({ summary: 'Assign a class teacher, subject teacher, coordinator or indicator' })
  @RequirePermission(ACADEMICS.assignmentManage, {
    description: 'Assign class teachers, subject teachers and coordinators',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateTeacherAssignmentDto) {
    return this.assignments.create(ctx, body);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'End an assignment today; roles and scopes follow' })
  @RequirePermission(ACADEMICS.assignmentManage)
  end(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assignments.end(ctx, id);
  }
}
