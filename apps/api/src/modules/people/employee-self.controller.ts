import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  EmployeeChangesDto,
  EmployeePolicyDto,
  StaffBulkDto,
  StaffDecideDto,
  StaffInboxDto,
} from './employee-self.dto';
import { EmployeeSelfService } from './employee-self.service';
import { PEOPLE } from './people.permissions';

/** Staff see and update their own profile; the school sets the rules and approves (0186). */
@ApiTags('people')
@ApiBearerAuth()
@Controller()
export class EmployeeSelfController {
  constructor(private readonly svc: EmployeeSelfService) {}

  @Get('me/employee-profile')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'My employee profile, what I may change, and my requests' })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.svc.mine(ctx);
  }

  @Post('me/employee-profile/changes')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Ask for changes (some apply at once, others go for approval)' })
  submit(@ReqCtx() ctx: RequestContext, @Body() body: EmployeeChangesDto) {
    return this.svc.submit(ctx, body);
  }

  @Post('me/employee-change-requests/:id/cancel')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Withdraw a request still waiting' })
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.cancel(ctx, id);
  }

  @Post('me/employee-profile/print')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'My profile as PDF (my ID numbers in full)' })
  print(@ReqCtx() ctx: RequestContext) {
    return this.svc.print(ctx);
  }

  @Get('me/exports/:id')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'One of my own exports (the profile PDF)' })
  myExport(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.exportStatus(ctx, id);
  }

  @Get('people/staff-profile/policy')
  @RequirePermission(PEOPLE.staffProfileManage)
  @ApiOperation({
    summary: 'What staff see and change on their profile, proofs, window, approvers',
  })
  policy(@ReqCtx() ctx: RequestContext) {
    return this.svc.policy(ctx);
  }

  @Put('people/staff-profile/policy')
  @RequirePermission(PEOPLE.staffProfileManage)
  @ApiOperation({ summary: 'Save the staff profile policy' })
  savePolicy(@ReqCtx() ctx: RequestContext, @Body() body: EmployeePolicyDto) {
    return this.svc.savePolicy(ctx, body);
  }

  @Get('people/staff-profile-approvals')
  // the HOD or L1/L2 approver from an employee's record decides what is routed to them; HR and
  // those who may override see all (checked in the service)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Staff profile changes waiting on me (or all, or decided)' })
  inbox(@ReqCtx() ctx: RequestContext, @Query() q: StaffInboxDto) {
    return this.svc.inbox(ctx, q);
  }

  @Post('people/staff-profile-approvals/:id/decide')
  @HttpCode(200)
  // the HOD or L1/L2 approver from an employee's record decides what is routed to them; HR and
  // those who may override see all (checked in the service)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Accept or refuse a request, field by field' })
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: StaffDecideDto) {
    return this.svc.decide(ctx, id, body);
  }

  @Post('people/staff-profile-approvals/bulk')
  @HttpCode(200)
  // the HOD or L1/L2 approver from an employee's record decides what is routed to them; HR and
  // those who may override see all (checked in the service)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Accept or refuse several requests' })
  bulk(@ReqCtx() ctx: RequestContext, @Body() body: StaffBulkDto) {
    return this.svc.bulk(ctx, body);
  }

  @Get('people/staff-profile-approvals/:id/proofs/:fileId')
  // the HOD or L1/L2 approver from an employee's record decides what is routed to them; HR and
  // those who may override see all (checked in the service)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'A proof document of a request' })
  proof(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.svc.proofUrl(ctx, id, fileId);
  }
}
