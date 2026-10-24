import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import { PEOPLE } from '../people.permissions';
import { CorrectionWithdrawDto } from '../student-corrections.dto';
import { AdmissionCancelDto } from './admission-cancellations.dto';
import { AdmissionCancellationsService } from './admission-cancellations.service';

/** Admitted by mistake (docs/design/37, part 4): cancel the admission with the fee settled. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class AdmissionCancellationsController {
  constructor(private readonly svc: AdmissionCancellationsService) {}

  @Get('admission-cancellations/setup')
  @ApiOperation({ summary: 'Who decides an admission cancellation, level by level' })
  @RequirePermission(PEOPLE.studentView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.svc.setup(ctx);
  }

  @Get('students/:id/admission-cancellations')
  @ApiOperation({ summary: 'The admission cancellations asked for a student, with the settlement' })
  @RequirePermission(PEOPLE.studentView)
  list(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.list(ctx, id);
  }

  @Post('students/:id/admission-cancellations/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What cancelling the admission would do: fee cancelled, refunds, logins (nothing saved)',
  })
  @RequirePermission(PEOPLE.admissionCancel)
  preview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AdmissionCancelDto,
  ) {
    return this.svc.preview(ctx, id, body);
  }

  @Post('students/:id/admission-cancellations')
  @ApiOperation({ summary: 'Ask to cancel the admission; done when the approval levels approve' })
  @RequirePermission(PEOPLE.admissionCancel)
  request(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AdmissionCancelDto,
  ) {
    return this.svc.request(ctx, id, body);
  }

  @Post('students/:id/admission-cancellations/:cancelId/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take back a cancellation still waiting (the requester)' })
  @RequirePermission(PEOPLE.admissionCancel)
  withdraw(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('cancelId') cancelId: string,
    @Body() body: CorrectionWithdrawDto,
  ) {
    return this.svc.withdraw(ctx, id, cancelId, body.reason);
  }
}
