import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  AddPortfolioDto,
  EXAMS,
  MyFeedbackQueryDto,
  PortfolioQueryDto,
  PutHpcFeedbackDto,
  PutMyFeedbackDto,
} from './exams.dto';
import { HpcService } from './hpc.service';

/** docs/design/65 part 5: the Holistic Progress Card's set, feedback and portfolio photos. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class HpcController {
  constructor(private readonly hpc: HpcService) {}

  @Post('indicator-sets/hpc')
  @ApiOperation({ summary: 'Add the NCERT foundational-stage progress card set (Balvatika to II)' })
  @RequirePermission(EXAMS.masterManage)
  install(@ReqCtx() ctx: RequestContext) {
    return this.hpc.installPreset(ctx);
  }

  @Put(':id/hpc-feedback')
  @ApiOperation({ summary: "The child's, the parent's and the teacher's words on the HPC" })
  @RequirePermission(EXAMS.indicatorEnter)
  feedback(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PutHpcFeedbackDto) {
    return this.hpc.putFeedback(ctx, id, dto);
  }

  @Get(':id/portfolio')
  @RequirePermission(EXAMS.marksView)
  portfolio(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: PortfolioQueryDto) {
    return this.hpc.portfolio(ctx, id, q);
  }

  @Post(':id/portfolio')
  @ApiOperation({ summary: "Add a photo to a child's portfolio (PNG or JPEG up to 1 MB)" })
  @RequirePermission(EXAMS.indicatorEnter)
  addPhoto(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: AddPortfolioDto) {
    return this.hpc.addPhoto(ctx, id, dto);
  }

  @Delete(':id/portfolio/:itemId')
  @RequirePermission(EXAMS.indicatorEnter)
  removePhoto(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.hpc.removePhoto(ctx, id, itemId);
  }

  @Get(':id/portfolio/:itemId/image')
  @RequirePermission(EXAMS.marksView)
  photo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.hpc.photo(ctx, id, itemId);
  }
}

/** A parent's own feedback on the child's progress card (the parent app). */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/mine')
export class FamilyHpcController {
  constructor(private readonly hpc: HpcService) {}

  @Get('feedback')
  @ApiOperation({ summary: "My feedback on my child's progress card, per exam" })
  @RequirePermission(EXAMS.familyFeedback, {
    description: "A parent writes their feedback on their child's holistic progress card",
  })
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MyFeedbackQueryDto) {
    return this.hpc.myFeedback(ctx, q.studentId);
  }

  @Put('feedback')
  @RequirePermission(EXAMS.familyFeedback)
  put(@ReqCtx() ctx: RequestContext, @Body() dto: PutMyFeedbackDto) {
    return this.hpc.putMyFeedback(ctx, dto);
  }
}
