import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  StudentGridDto,
  StudentGridExportDto,
  BulkTemplateQueryDto,
  BulkUploadDto,
  IdSchema,
  NextNumbersQueryDto,
  ProfileQueryDto,
  QuickAddDto,
  UpdateProfileDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentBulkService } from './student-bulk.service';
import { StudentGridService } from './student-grid.service';
import { StudentProfileService } from './student-profile.service';

const idOf = (id: string): string => {
  if (!IdSchema.safeParse(id).success) throw new DomainError('not-found', 'Student not found');
  return id;
};

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class StudentProfileController {
  constructor(
    private readonly profile: StudentProfileService,
    private readonly bulk: StudentBulkService,
    private readonly grid: StudentGridService,
  ) {}

  private static sendXlsx(reply: FastifyReply, file: { fileName: string; bytes: Buffer }) {
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${file.fileName}"`)
      .send(file.bytes);
  }

  @Get('students/grid/fields')
  @ApiOperation({ summary: 'Fields the students list can show and filter on' })
  @RequirePermission(PEOPLE.studentView)
  studentGridFields(@ReqCtx() ctx: RequestContext) {
    return this.grid.fields(ctx);
  }

  @Post('students/grid')
  @ApiOperation({
    summary: 'Students list: chosen columns, filters on any field, search, status counts, pages',
  })
  @RequirePermission(PEOPLE.studentView)
  studentGrid(@ReqCtx() ctx: RequestContext, @Body() body: StudentGridDto) {
    return this.grid.grid(ctx, body);
  }

  @Post('students/grid/export')
  @ApiOperation({ summary: 'The current students list view as a branded Excel or PDF' })
  @RequirePermission(PEOPLE.studentView)
  studentGridExport(@ReqCtx() ctx: RequestContext, @Body() body: StudentGridExportDto) {
    return this.grid.export(ctx, body);
  }

  @Get('profile/bulk/template')
  @ApiOperation({
    summary: 'Excel template for bulk update (pre-filled by admission no) or bulk create',
  })
  @RequirePermission(PEOPLE.importRun, { description: 'Run student and employee uploads' })
  async bulkTemplate(
    @ReqCtx() ctx: RequestContext,
    @Query() q: BulkTemplateQueryDto,
    @Res() reply: FastifyReply,
  ) {
    StudentProfileController.sendXlsx(reply, await this.bulk.template(ctx, q));
  }

  @Get('profile/bulk')
  @ApiOperation({ summary: 'Recent student profile uploads' })
  @RequirePermission(PEOPLE.importRun)
  async bulkList(@ReqCtx() ctx: RequestContext) {
    return { data: await this.bulk.list(ctx) };
  }

  @Post('profile/bulk/validate')
  @ApiOperation({ summary: 'Check an upload: match by admission no, validate, show old → new' })
  @RequirePermission(PEOPLE.importRun)
  bulkValidate(@ReqCtx() ctx: RequestContext, @Body() body: BulkUploadDto) {
    return this.bulk.validate(ctx, body);
  }

  @Get('profile/bulk/:id')
  @ApiOperation({ summary: 'A checked upload: counts, problems and the old → new preview' })
  @RequirePermission(PEOPLE.importRun)
  bulkSummary(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bulk.summary(ctx, idOf(id));
  }

  @Post('profile/bulk/:id/commit')
  @ApiOperation({ summary: 'Apply the valid rows of a checked upload' })
  @RequirePermission(PEOPLE.importRun)
  bulkCommit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bulk.commit(ctx, idOf(id));
  }

  @Get('profile/bulk/:id/result')
  @ApiOperation({ summary: 'Outcome of every row of an upload, as Excel' })
  @RequirePermission(PEOPLE.importRun)
  async bulkResult(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    StudentProfileController.sendXlsx(reply, await this.bulk.resultFile(ctx, idOf(id)));
  }

  @Get('profile/catalogue')
  @ApiOperation({ summary: 'Student profile sections, fields, drop-down options and geography' })
  @RequirePermission(PEOPLE.studentView)
  catalogue(@ReqCtx() ctx: RequestContext) {
    return this.profile.catalogue(ctx);
  }

  @Get('profile/sibling')
  @ApiOperation({ summary: 'Find a sibling by admission number (name, class, parents) to verify' })
  @RequirePermission(PEOPLE.studentView)
  sibling(
    @ReqCtx() ctx: RequestContext,
    @Query('admissionNo') admissionNo?: string,
    @Query('exclude') exclude?: string,
  ) {
    const no = (admissionNo ?? '').trim();
    if (!no || no.length > 40)
      throw new DomainError('validation-failed', 'Enter an admission number', { status: 400 });
    return this.profile.sibling(ctx, no, exclude && /^\d{1,18}$/.test(exclude) ? exclude : null);
  }

  @Get('profile/next-numbers')
  @ApiOperation({ summary: 'Suggested next admission number and roll number for quick add' })
  @RequirePermission(PEOPLE.studentCreate)
  nextNumbers(@ReqCtx() ctx: RequestContext, @Query() q: NextNumbersQueryDto) {
    return this.profile.nextNumbers(ctx, q.classSectionId);
  }

  @Post('profile/quick-add')
  @ApiOperation({ summary: 'Quick student add: minimum fields, enrolled in a section' })
  @RequirePermission(PEOPLE.studentCreate)
  quickAdd(@ReqCtx() ctx: RequestContext, @Body() body: QuickAddDto) {
    return this.profile.quickAdd(ctx, body);
  }

  @Get('students/:id/profile')
  @ApiOperation({
    summary:
      'Every profile field of a student; Aadhaar, PAN and bank account masked unless permitted',
  })
  @RequirePermission(PEOPLE.studentView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: ProfileQueryDto) {
    return this.profile.get(ctx, idOf(id), q.academicYearId);
  }

  @Patch('students/:id/profile')
  @ApiOperation({ summary: 'Change profile fields; only the keys sent change, null clears' })
  @RequirePermission(PEOPLE.studentEdit)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateProfileDto) {
    return this.profile.update(ctx, idOf(id), body);
  }
}
