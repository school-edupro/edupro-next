import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import {
  CreateSubjectDto,
  ListSubjectsQueryDto,
  SetClassSubjectsDto,
  UpdateSubjectDto,
} from './academics.dto';
import { ACADEMICS } from './academics.permissions';
import { SubjectsService } from './subjects.service';

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get('subjects')
  @ApiOperation({ summary: 'List subjects' })
  @RequirePermission(ACADEMICS.subjectView, {
    description: 'View subjects and class-subject mapping',
  })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListSubjectsQueryDto) {
    const { rows, total } = await this.subjects.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('subjects/:id')
  @RequirePermission(ACADEMICS.subjectView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.subjects.get(ctx, id);
  }

  @Post('subjects')
  @ApiOperation({ summary: 'Create a subject' })
  @RequirePermission(ACADEMICS.subjectManage, {
    description: 'Create and edit subjects and class-subject mapping',
  })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateSubjectDto) {
    return this.subjects.create(ctx, body);
  }

  @Patch('subjects/:id')
  @RequirePermission(ACADEMICS.subjectManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateSubjectDto) {
    return this.subjects.update(ctx, id, body);
  }

  @Delete('subjects/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a subject (refused while mapped in an open year)' })
  @RequirePermission(ACADEMICS.subjectManage)
  async remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string): Promise<void> {
    await this.subjects.remove(ctx, id);
  }

  @Get('classes/:classId/subjects')
  @ApiOperation({ summary: 'Subjects taught in a class in the working year' })
  @RequirePermission(ACADEMICS.subjectView)
  async classSubjects(@ReqCtx() ctx: RequestContext, @Param('classId') classId: string) {
    return { data: await this.subjects.listClassSubjects(ctx, classId) };
  }

  @Put('classes/:classId/subjects')
  @ApiOperation({ summary: 'Replace the subject list of a class for the working year' })
  @RequirePermission(ACADEMICS.subjectManage)
  async setClassSubjects(
    @ReqCtx() ctx: RequestContext,
    @Param('classId') classId: string,
    @Body() body: SetClassSubjectsDto,
  ) {
    return { data: await this.subjects.setClassSubjects(ctx, classId, body) };
  }
}
