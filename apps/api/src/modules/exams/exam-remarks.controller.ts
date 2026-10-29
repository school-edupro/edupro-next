import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LIFECYCLE } from '../people/lifecycle/lifecycle.dto';
import {
  EntryQueryDto,
  EXAMS,
  PutRemarkItemsDto,
  SchemePromotionQueryDto,
  SendPromotionsDto,
  UpsertRemarkCategoryDto,
} from './exams.dto';
import { RemarkCategoriesService } from './remark-categories.service';
import { SchemePromotionService } from './scheme-promotion.service';

/** docs/design/65 part 7: remark categories and their remarks; promotion proposals from term results. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamRemarksController {
  constructor(
    private readonly remarks: RemarkCategoriesService,
    private readonly promotion: SchemePromotionService,
  ) {}

  @Get('remark-categories')
  @RequirePermission(EXAMS.masterView)
  categories(@ReqCtx() ctx: RequestContext) {
    return this.remarks.list(ctx);
  }

  @Put('remark-categories')
  @ApiOperation({ summary: 'Add or change a remark category (by its code)' })
  @RequirePermission(EXAMS.masterManage)
  upsertCategory(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertRemarkCategoryDto) {
    return this.remarks.upsert(ctx, dto);
  }

  @Get('schemes/:id/promotion')
  @ApiOperation({ summary: "Promotion proposals from a locked result scheme's term results" })
  @RequirePermission(EXAMS.marksView)
  proposals(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: SchemePromotionQueryDto,
  ) {
    return this.promotion.proposals(ctx, id, q);
  }

  @Post('schemes/:id/promotion')
  @ApiOperation({
    summary: "Send the decisions to People → Promotions and fill the cards' Promoted to",
  })
  @RequirePermission(LIFECYCLE.promotionManage)
  send(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SendPromotionsDto) {
    return this.promotion.send(ctx, id, dto);
  }

  @Get(':id/remark-items')
  @RequirePermission(EXAMS.marksView)
  items(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: EntryQueryDto) {
    return this.remarks.items(ctx, id, q);
  }

  @Put(':id/remark-items')
  @ApiOperation({
    summary:
      'Remarks by category: the class teacher any category, a subject teacher their subject’s',
  })
  @AuthenticatedOnly()
  putItems(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PutRemarkItemsDto) {
    return this.remarks.putItems(ctx, id, dto);
  }
}
