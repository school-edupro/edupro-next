import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AreaEntryService } from './area-entry.service';
import { CloseAreaEntryDto, EXAMS, OpenAreaEntryDto } from './exams.dto';

/**
 * docs/design/98: a section's indicators, remarks, exam attendance or height and weight reopened for entry while
 * the exam (or the class's lock of that area) stays locked.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class AreaEntryController {
  constructor(private readonly svc: AreaEntryService) {}

  @Get(':id/area-entry')
  @ApiOperation({
    summary:
      "The exam's sections reopened for entry under the lock (indicators, remarks, attendance, health)",
  })
  @RequirePermission(EXAMS.marksView)
  list(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.list(ctx, id);
  }

  @Post(':id/area-entry/open')
  @ApiOperation({
    summary:
      "Reopen one section's indicators, remarks, exam attendance or height and weight for entry under the lock (the school admin, a reason and a closing time)",
  })
  @RequirePermission(EXAMS.lockManage)
  open(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: OpenAreaEntryDto) {
    return this.svc.open(ctx, id, dto);
  }

  @Post(':id/area-entry/close')
  @ApiOperation({
    summary:
      "Close a section's reopened area: the class teacher's Done or the school admin's Close now (checked by the service)",
  })
  @AuthenticatedOnly()
  close(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CloseAreaEntryDto) {
    return this.svc.close(ctx, id, dto);
  }
}
