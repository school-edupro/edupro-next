import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EmployeeTransferService } from './employee-transfer.service';
import {
  EmployeeCampusMoveDto,
  EmployeeTransferAcceptDto,
  EmployeeTransferCloseDto,
  EmployeeTransferRequestDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';

/** Staff transfers (docs/design/30-employee-master.md): between campuses, and to other schools of the group. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class EmployeeTransferController {
  constructor(private readonly svc: EmployeeTransferService) {}

  @Post('staff/:id/campus-move')
  @ApiOperation({ summary: 'Move an employee to another campus of the school from a date' })
  @RequirePermission(PEOPLE.staffTransfer, {
    description:
      'Move staff between campuses and to other schools of the group, accept incoming staff',
  })
  campusMove(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: EmployeeCampusMoveDto,
  ) {
    return this.svc.campusMove(ctx, id, body);
  }

  @Post('staff/:id/transfer')
  @ApiOperation({ summary: 'Ask another school of the group to take this employee' })
  @RequirePermission(PEOPLE.staffTransfer)
  request(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: EmployeeTransferRequestDto,
  ) {
    return this.svc.request(ctx, id, body);
  }

  @Get('staff-transfers/targets')
  @RequirePermission(PEOPLE.staffTransfer)
  targets(@ReqCtx() ctx: RequestContext) {
    return this.svc.targets(ctx);
  }

  @Get('staff-transfers')
  @ApiOperation({ summary: 'Staff transfers in and out of this school' })
  @RequirePermission(PEOPLE.staffTransfer)
  list(@ReqCtx() ctx: RequestContext, @Query('box') box?: string) {
    return this.svc.list(ctx, box === 'incoming' || box === 'outgoing' ? box : 'all');
  }

  @Post('staff-transfers/:tid/accept')
  @ApiOperation({
    summary: 'Take the employee into this school (department, designation, type, campus, code)',
  })
  @RequirePermission(PEOPLE.staffTransfer)
  accept(
    @ReqCtx() ctx: RequestContext,
    @Param('tid') tid: string,
    @Body() body: EmployeeTransferAcceptDto,
  ) {
    return this.svc.accept(ctx, tid, body);
  }

  @Post('staff-transfers/:tid/reject')
  @RequirePermission(PEOPLE.staffTransfer)
  reject(
    @ReqCtx() ctx: RequestContext,
    @Param('tid') tid: string,
    @Body() body: EmployeeTransferCloseDto,
  ) {
    return this.svc.close(ctx, tid, 'rejected', body.reason);
  }

  @Post('staff-transfers/:tid/cancel')
  @RequirePermission(PEOPLE.staffTransfer)
  cancel(
    @ReqCtx() ctx: RequestContext,
    @Param('tid') tid: string,
    @Body() body: EmployeeTransferCloseDto,
  ) {
    return this.svc.close(ctx, tid, 'cancelled', body.reason);
  }
}
