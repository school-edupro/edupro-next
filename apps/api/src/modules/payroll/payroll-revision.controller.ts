import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { DueQueryDto, ProposeDto, RevisionDto } from './payroll-revision.dto';
import { PayrollRevisionService } from './payroll-revision.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Revisions and increments (docs/design/86, phase E step 3): draft, simulate, apply (another checker), letters. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollRevisionController {
  constructor(private readonly rev: PayrollRevisionService) {}

  @Get('revisions')
  @ApiOperation({ summary: 'The revisions: drafts, applied, cancelled' })
  @RequirePermission(RUN.view)
  list(@ReqCtx() ctx: RequestContext) {
    return this.rev.list(ctx);
  }

  @Post('revisions')
  @ApiOperation({ summary: 'Draft a revision of a rate (DA) or a head’s formula (a maker)' })
  @RequirePermission(RUN.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: RevisionDto) {
    return this.rev.create(ctx, dto);
  }

  @Get('revisions/:id/simulate')
  @ApiOperation({ summary: 'What applying would give: the arrears by employee, head and month' })
  @RequirePermission(RUN.view)
  simulate(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.rev.simulate(ctx, id(rid));
  }

  @Post('revisions/:id/apply')
  @ApiOperation({
    summary: 'Apply a revision or the month’s increments (a checker who did not draft it)',
  })
  @RequirePermission(RUN.approve)
  apply(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.rev.apply(ctx, id(rid));
  }

  @Post('revisions/:id/cancel')
  @ApiOperation({ summary: 'Cancel a draft revision' })
  @RequirePermission(RUN.manage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.rev.cancel(ctx, id(rid));
  }

  @Get('revisions/:id/letters')
  @ApiOperation({ summary: 'A revision’s letters' })
  @RequirePermission(RUN.view)
  letters(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.rev.letters(ctx, id(rid));
  }

  @Get('increments')
  @ApiOperation({ summary: 'Who is due an increment in a month, and to what' })
  @RequirePermission(RUN.view)
  due(@ReqCtx() ctx: RequestContext, @Query() q: DueQueryDto) {
    return this.rev.due(ctx, q.month);
  }

  @Post('increments')
  @ApiOperation({ summary: 'Propose the month’s increments for the staff ticked (a maker)' })
  @RequirePermission(RUN.manage)
  propose(@ReqCtx() ctx: RequestContext, @Body() dto: ProposeDto) {
    return this.rev.propose(ctx, dto.month, dto.employeeIds, dto.reason);
  }
}
