import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IdSchema } from '../academics/classes/classes.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EmployeeBulkService } from './employee-bulk.service';
import { EmployeeGridService } from './employee-grid.service';
import { EmployeeProfileService } from './employee-profile.service';
import {
  BulkUploadDto,
  EmployeeBulkTemplateQueryDto,
  EmployeeGridDto,
  EmployeeGridExportDto,
  EmployeeOnboardDto,
  EmployeeProfileDto,
  EmployeeRowKindSchema,
  type EmployeeRowKind,
} from './people.dto';
import { PEOPLE } from './people.permissions';

const uploadOf = (id: string): string => {
  if (!IdSchema.safeParse(id).success) throw new DomainError('not-found', 'Upload not found');
  return id;
};

const kindOf = (k: string): EmployeeRowKind => {
  const r = EmployeeRowKindSchema.safeParse(k);
  if (!r.success) throw new DomainError('not-found', 'Unknown list', { status: 404 });
  return r.data;
};

/** The employee master (docs/design/30-employee-master.md): catalogue, profile, onboarding, rows. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/staff')
export class EmployeeProfileController {
  constructor(
    private readonly svc: EmployeeProfileService,
    private readonly grid: EmployeeGridService,
    private readonly bulk: EmployeeBulkService,
  ) {}

  private static xlsx(reply: FastifyReply, file: { fileName: string; bytes: Buffer }) {
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${file.fileName}"`)
      .send(file.bytes);
  }

  // ---- Excel upload (part 3) ----
  @Get('bulk/template')
  @ApiOperation({ summary: 'Employee Excel template: update (pre-filled by code) or create' })
  @RequirePermission(PEOPLE.importRun)
  async bulkTemplate(
    @ReqCtx() ctx: RequestContext,
    @Query() q: EmployeeBulkTemplateQueryDto,
    @Res() reply: FastifyReply,
  ) {
    EmployeeProfileController.xlsx(reply, await this.bulk.template(ctx, q));
  }

  @Get('bulk')
  @ApiOperation({ summary: 'Recent employee uploads' })
  @RequirePermission(PEOPLE.importRun)
  async bulkList(@ReqCtx() ctx: RequestContext) {
    return { data: await this.bulk.list(ctx) };
  }

  @Post('bulk/validate')
  @ApiOperation({ summary: 'Check an employee upload: match by code, validate, show old → new' })
  @RequirePermission(PEOPLE.importRun)
  bulkValidate(@ReqCtx() ctx: RequestContext, @Body() body: BulkUploadDto) {
    return this.bulk.validate(ctx, body);
  }

  @Get('bulk/:uploadId')
  @RequirePermission(PEOPLE.importRun)
  bulkSummary(@ReqCtx() ctx: RequestContext, @Param('uploadId') id: string) {
    return this.bulk.summary(ctx, uploadOf(id));
  }

  @Post('bulk/:uploadId/commit')
  @ApiOperation({ summary: 'Apply the valid rows of a checked employee upload' })
  @RequirePermission(PEOPLE.importRun)
  bulkCommit(@ReqCtx() ctx: RequestContext, @Param('uploadId') id: string) {
    return this.bulk.commit(ctx, uploadOf(id));
  }

  @Get('bulk/:uploadId/result')
  @RequirePermission(PEOPLE.importRun)
  async bulkResult(
    @ReqCtx() ctx: RequestContext,
    @Param('uploadId') id: string,
    @Res() reply: FastifyReply,
  ) {
    EmployeeProfileController.xlsx(reply, await this.bulk.resultFile(ctx, uploadOf(id)));
  }

  @Get('grid/fields')
  @ApiOperation({ summary: 'Every field that can be a column or a filter of the employee list' })
  @RequirePermission(PEOPLE.employeeView)
  gridFields(@ReqCtx() ctx: RequestContext) {
    return this.grid.fields(ctx);
  }

  @Post('grid')
  @HttpCode(200)
  @ApiOperation({ summary: 'The employee list: columns, filters, search, status, sort, page' })
  @RequirePermission(PEOPLE.employeeView)
  gridRows(@ReqCtx() ctx: RequestContext, @Body() body: EmployeeGridDto) {
    return this.grid.grid(ctx, body);
  }

  @Post('grid/export')
  @ApiOperation({ summary: 'The current employee list view as Excel or PDF (an export job)' })
  @RequirePermission(PEOPLE.employeeView)
  gridExport(@ReqCtx() ctx: RequestContext, @Body() body: EmployeeGridExportDto) {
    return this.grid.export(ctx, body);
  }

  @Get('catalogue')
  @ApiOperation({
    summary: 'The employee fields by section, the lists, the quick keys, the next code',
  })
  @RequirePermission(PEOPLE.employeeView)
  catalogue(@ReqCtx() ctx: RequestContext) {
    return this.svc.catalogue(ctx);
  }

  @Post('onboard')
  @ApiOperation({ summary: 'Quick onboarding with the minimum fields (and a staff login)' })
  @RequirePermission(PEOPLE.employeeCreate)
  onboard(@ReqCtx() ctx: RequestContext, @Body() body: EmployeeOnboardDto) {
    return this.svc.onboard(ctx, body);
  }

  @Get(':id/profile')
  @RequirePermission(PEOPLE.employeeView)
  profile(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.profile(ctx, id);
  }

  @Put(':id/profile')
  @RequirePermission(PEOPLE.employeeEdit)
  save(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EmployeeProfileDto) {
    return this.svc.save(ctx, id, body);
  }

  @Post(':id/login')
  @ApiOperation({ summary: 'A staff login for an employee who has none' })
  @RequirePermission(PEOPLE.employeeEdit)
  login(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.createLogin(ctx, id);
  }

  @Post(':id/rows/:kind')
  @ApiOperation({ summary: 'Add an education, language, experience, transfer or remark row' })
  @RequirePermission(PEOPLE.employeeEdit)
  addRow(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    return this.svc.addRow(ctx, id, kindOf(kind), body);
  }

  @Put(':id/rows/:kind/:rowId')
  @RequirePermission(PEOPLE.employeeEdit)
  updateRow(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('rowId') rowId: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateRow(ctx, id, kindOf(kind), rowId, body);
  }

  @Delete(':id/rows/:kind/:rowId')
  @RequirePermission(PEOPLE.employeeEdit)
  removeRow(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('rowId') rowId: string,
  ) {
    return this.svc.removeRow(ctx, id, kindOf(kind), rowId);
  }
}
