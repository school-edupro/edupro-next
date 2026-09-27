import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeDemandsService } from './fee-demands.service';
import { FeeMastersService } from './fee-masters.service';
import {
  ClassSummaryQueryDto,
  CreateDiscountDto,
  CreateHeadDto,
  CreateSlabDto,
  FEES,
  GenerateClassDemandDto,
  GeneratePeriodsDto,
  ListDemandsQueryDto,
  SetProfileDto,
  SetStructureDto,
  UpdateHeadDto,
} from './fees.dto';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
export class FeesController {
  constructor(
    private readonly masters: FeeMastersService,
    private readonly demands: FeeDemandsService,
  ) {}

  // ---- masters ------------------------------------------------------------------------------------
  @Get('heads')
  @RequirePermission(FEES.masterView, {
    description: 'View fee heads, periods, structures, slabs and discounts',
  })
  async heads(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.heads(ctx) };
  }

  @Post('heads')
  @RequirePermission(FEES.masterManage, {
    description: 'Edit fee heads, periods, structures, slabs and discounts',
  })
  createHead(@ReqCtx() ctx: RequestContext, @Body() body: CreateHeadDto) {
    return this.masters.createHead(ctx, body);
  }

  @Patch('heads/:id')
  @RequirePermission(FEES.masterManage)
  updateHead(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateHeadDto) {
    return this.masters.updateHead(ctx, id, body);
  }

  @Get('periods')
  @ApiOperation({
    summary: 'Fee periods (months) of the working year with instalments and due dates',
  })
  @RequirePermission(FEES.masterView)
  async periods(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.periods(ctx) };
  }

  @Post('periods/generate')
  @ApiOperation({ summary: 'Generate the twelve periods of the working year' })
  @RequirePermission(FEES.masterManage)
  async generatePeriods(@ReqCtx() ctx: RequestContext, @Body() body: GeneratePeriodsDto) {
    return { data: await this.masters.generatePeriods(ctx, body) };
  }

  @Get('structures')
  @RequirePermission(FEES.masterView)
  async structures(@ReqCtx() ctx: RequestContext, @Query('classId') classId?: string) {
    return {
      data: await this.masters.structures(
        ctx,
        classId && /^\d{1,18}$/.test(classId) ? classId : undefined,
      ),
    };
  }

  @Put('structures/:classId')
  @ApiOperation({
    summary: 'Replace the fee structure of a class and fee group for the working year',
  })
  @RequirePermission(FEES.masterManage)
  async setStructure(
    @ReqCtx() ctx: RequestContext,
    @Param('classId') classId: string,
    @Body() body: SetStructureDto,
  ) {
    return { data: await this.masters.setStructure(ctx, classId, body) };
  }

  @Get('slabs')
  @RequirePermission(FEES.masterView)
  async slabs(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.slabs(ctx) };
  }

  @Post('slabs')
  @RequirePermission(FEES.masterManage)
  createSlab(@ReqCtx() ctx: RequestContext, @Body() body: CreateSlabDto) {
    return this.masters.createSlab(ctx, body);
  }

  @Get('discounts')
  @RequirePermission(FEES.masterView)
  async discounts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.masters.discounts(ctx) };
  }

  @Post('discounts')
  @RequirePermission(FEES.masterManage)
  createDiscount(@ReqCtx() ctx: RequestContext, @Body() body: CreateDiscountDto) {
    return this.masters.createDiscount(ctx, body);
  }

  // ---- students -------------------------------------------------------------------------------------
  @Get('students/:id/profile')
  @RequirePermission(FEES.demandView, { description: 'View fee demands and dues' })
  profile(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.demands.profile(ctx, id);
  }

  @Put('students/:id/profile')
  @RequirePermission(FEES.profileManage, {
    description: "Set a student's fee group, transport slab, discount and opening balance",
  })
  setProfile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SetProfileDto) {
    return this.demands.setProfile(ctx, id, body);
  }

  @Get('students/:id/demands')
  @ApiOperation({ summary: 'Demand rows of the working year with instalment and year totals' })
  @RequirePermission(FEES.demandView)
  studentDemands(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListDemandsQueryDto,
  ) {
    return this.demands.demands(ctx, id, q);
  }

  @Post('students/:id/demands/generate')
  @ApiOperation({ summary: 'Generate or regenerate the demand (legacy GenerateFee rules)' })
  @RequirePermission(FEES.demandGenerate, { description: 'Generate or regenerate fee demands' })
  generate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.demands.generate(ctx, id);
  }

  @Post('demands/generate')
  @ApiOperation({ summary: 'Generate demands for every active student of a class' })
  @RequirePermission(FEES.demandGenerate)
  generateClass(@ReqCtx() ctx: RequestContext, @Body() body: GenerateClassDemandDto) {
    return this.demands.generateForClass(ctx, body.classId);
  }

  @Get('demands/summary')
  @ApiOperation({ summary: 'Per-student demand totals of a class' })
  @RequirePermission(FEES.demandView)
  async classSummary(@ReqCtx() ctx: RequestContext, @Query() q: ClassSummaryQueryDto) {
    return { data: await this.demands.classSummary(ctx, q.classId) };
  }
}
