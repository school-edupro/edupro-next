import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import {
  BulkTeacherAssignmentDto,
  CreateTeacherAssignmentDto,
  ImportTeacherAssignmentsDto,
  ListTeacherAssignmentsQueryDto,
} from './academics.dto';
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

  @Post('bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'One teacher, one type, many classes and subjects in one save' })
  @RequirePermission(ACADEMICS.assignmentManage)
  bulk(@ReqCtx() ctx: RequestContext, @Body() body: BulkTeacherAssignmentDto) {
    return this.assignments.bulk(ctx, body);
  }

  @Get('template.xlsx')
  @ApiOperation({ summary: 'The Excel format for teacher assignments, with drop-downs' })
  @RequirePermission(ACADEMICS.assignmentManage)
  async template(@ReqCtx() ctx: RequestContext, @Res() reply: FastifyReply) {
    const f = await this.assignments.template(ctx);
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Teacher assignments from the filled Excel format' })
  @RequirePermission(ACADEMICS.assignmentManage)
  import(@ReqCtx() ctx: RequestContext, @Body() body: ImportTeacherAssignmentsDto) {
    return this.assignments.import(ctx, body.fileBase64);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'End an assignment today; roles and scopes follow' })
  @RequirePermission(ACADEMICS.assignmentManage)
  end(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assignments.end(ctx, id);
  }
}
