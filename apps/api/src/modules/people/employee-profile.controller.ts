import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EmployeeProfileService } from './employee-profile.service';
import {
  EmployeeOnboardDto,
  EmployeeProfileDto,
  EmployeeRowKindSchema,
  type EmployeeRowKind,
} from './people.dto';
import { PEOPLE } from './people.permissions';

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
  constructor(private readonly svc: EmployeeProfileService) {}

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
