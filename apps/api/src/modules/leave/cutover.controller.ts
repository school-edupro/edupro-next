import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LeaveCutoverService, type CutoverStep } from './cutover.service';
import { CutoverSettingsDto } from './leave.dto';

/** Moving from the earlier leave module (docs/design/85, phase E). */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('staff-cutover')
export class LeaveCutoverController {
  constructor(private readonly cut: LeaveCutoverService) {}

  @Get()
  @ApiOperation({ summary: 'Where the cut-over is: the months, the last read, each step' })
  @RequirePermission('leave.setup.view')
  overview(@ReqCtx() ctx: RequestContext) {
    return this.cut.overview(ctx);
  }

  @Post('settings')
  @ApiOperation({ summary: 'The parallel month and the freeze date' })
  @RequirePermission('leave.setup.manage')
  settings(@ReqCtx() ctx: RequestContext, @Body() body: CutoverSettingsDto) {
    return this.cut.settings(ctx, body);
  }

  @Post('read')
  @ApiOperation({ summary: 'Ask the workers to read the old database now (read only)' })
  @RequirePermission('leave.setup.manage')
  read(@ReqCtx() ctx: RequestContext) {
    return this.cut.requestRead(ctx);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Each step run and rolled back: what would come, what cannot' })
  @RequirePermission('leave.setup.view')
  preview(@ReqCtx() ctx: RequestContext) {
    return this.cut.preview(ctx);
  }

  @Post('steps/:step')
  @ApiOperation({ summary: 'Bring a step in: setup, balances or history' })
  @RequirePermission('leave.setup.manage')
  step(@ReqCtx() ctx: RequestContext, @Param('step') step: string) {
    return this.cut.run(ctx, step as CutoverStep);
  }

  @Get('compare')
  @ApiOperation({
    summary: 'The parallel month: the days and balances where the old and new differ',
  })
  @RequirePermission('leave.setup.view')
  compare(@ReqCtx() ctx: RequestContext) {
    return this.cut.compare(ctx);
  }

  @Post('switch')
  @ApiOperation({ summary: 'After the freeze: what still waits starts here; the old module stops' })
  @RequirePermission('leave.setup.manage')
  switchOver(@ReqCtx() ctx: RequestContext) {
    return this.cut.switchOver(ctx);
  }
}
