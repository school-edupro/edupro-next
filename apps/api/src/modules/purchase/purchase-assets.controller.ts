import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseAssetsService } from './purchase-assets.service';
import { PurchaseCondemnationsService } from './purchase-condemnations.service';
import { PurchaseReorderService } from './purchase-reorder.service';
import {
  AcknowledgeDto,
  AssetDto,
  AssetExportQueryDto,
  AssetImportDto,
  AssetListQueryDto,
  AssetMoveDto,
  CommitteeMemberDto,
  CondemnationDecisionDto,
  CondemnationDto,
  DepreciationRunDto,
  DisposalDto,
  PURCHASE,
  ReasonDto,
  ReorderIndentDto,
  StockDocQueryDto,
} from './purchase.dto';

const pdf = (
  reply: FastifyReply,
  save: string | undefined,
  f: { bytes: Buffer; filename: string },
) =>
  void reply
    .header('content-type', 'application/pdf')
    .header(
      'content-disposition',
      `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
    )
    .header('cache-control', 'private, no-store')
    .send(f.bytes);

/**
 * Purchase phase 2, part 9 (docs/design/84): reorder, the asset register (movements, labels, import,
 * depreciation) and condemnation with disposal. Custodians and committee members act on what is theirs
 * (checked in the services).
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseAssetsController {
  constructor(
    private readonly assets: PurchaseAssetsService,
    private readonly condemnations: PurchaseCondemnationsService,
    private readonly reorder: PurchaseReorderService,
  ) {}

  // ---- reorder --------------------------------------------------------------------------------------
  @Get('reorder')
  @ApiOperation({ summary: 'Items at or below their reorder level, per store' })
  @RequirePermission(PURCHASE.storeView)
  reorderList(@ReqCtx() ctx: RequestContext) {
    return this.reorder.list(ctx);
  }

  @Post('reorder/indent')
  @ApiOperation({ summary: 'A draft indent for the store’s department with the items to reorder' })
  @RequirePermission(PURCHASE.indentRaise)
  reorderIndent(@ReqCtx() ctx: RequestContext, @Body() body: ReorderIndentDto) {
    return this.reorder.raiseIndent(ctx, body);
  }

  // ---- assets ---------------------------------------------------------------------------------------
  @Get('assets')
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: AssetListQueryDto) {
    return this.assets.list(ctx, q);
  }

  @Get('asset-lists')
  @AuthenticatedOnly()
  lists(@ReqCtx() ctx: RequestContext) {
    return this.assets.lists(ctx);
  }

  @Get('assets-mine')
  @ApiOperation({ summary: 'The assets I keep, and custody changes waiting for me' })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext) {
    return this.assets.mine(ctx);
  }

  @Get('assets-of-employee/:employeeId')
  @AuthenticatedOnly()
  ofEmployee(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.assets.ofEmployee(ctx, employeeId);
  }

  @Get('asset-labels')
  @ApiOperation({ summary: 'A sheet of QR labels for the assets (?ids=1,2,3)' })
  @AuthenticatedOnly()
  async labels(
    @ReqCtx() ctx: RequestContext,
    @Query('ids') ids: string | undefined,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const list = (ids ?? '').split(',').filter((x) => /^\d{1,18}$/.test(x));
    if (!list.length || list.length > 600)
      throw new DomainError('validation-failed', 'Pick the assets to label (up to 600)', {
        status: 400,
      });
    pdf(reply, save, await this.assets.labels(ctx, list));
  }

  @Get('assets/export')
  @ApiOperation({
    summary:
      'The asset master as filtered (every page): Excel with every field and totals by category, or PDF',
  })
  @AuthenticatedOnly()
  exportRegister(@ReqCtx() ctx: RequestContext, @Query() q: AssetExportQueryDto) {
    return this.assets.exportRegister(ctx, q);
  }

  @Get('assets-format')
  @RequirePermission(PURCHASE.assetManage)
  format(@ReqCtx() ctx: RequestContext) {
    return this.assets.importTemplate(ctx);
  }

  @Post('assets-import')
  @ApiOperation({
    summary: 'Existing assets from Excel: every row checked first, the good ones saved',
  })
  @RequirePermission(PURCHASE.assetManage)
  importAssets(@ReqCtx() ctx: RequestContext, @Body() body: AssetImportDto) {
    return this.assets.importAssets(ctx, body);
  }

  @Post('depreciation')
  @ApiOperation({ summary: 'The year’s depreciation (dry run first)' })
  @RequirePermission(PURCHASE.assetManage)
  depreciate(@ReqCtx() ctx: RequestContext, @Body() body: DepreciationRunDto) {
    return this.assets.depreciate(ctx, body);
  }

  @Get('assets/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assets.get(ctx, id);
  }

  @Put('assets/:id')
  @RequirePermission(PURCHASE.assetManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AssetDto) {
    return this.assets.update(ctx, id, body);
  }

  @Post('assets/:id/move')
  @ApiOperation({
    summary: 'Custody (waits for the new custodian), repair out / back, lost / found',
  })
  @RequirePermission(PURCHASE.assetManage)
  move(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AssetMoveDto) {
    return this.assets.move(ctx, id, body);
  }

  @Post('asset-movements/:id/acknowledge')
  @AuthenticatedOnly()
  acknowledge(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AcknowledgeDto,
  ) {
    return this.assets.acknowledge(ctx, id, body.note, body.onPaper);
  }

  @Post('asset-movements/:id/cancel')
  @RequirePermission(PURCHASE.assetManage)
  cancelMove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.assets.cancelMove(ctx, id);
  }

  // ---- condemnation -----------------------------------------------------------------------------------
  @Get('condemnation-committee')
  @RequirePermission(PURCHASE.masterView)
  committee(@ReqCtx() ctx: RequestContext) {
    return this.condemnations.committeeList(ctx);
  }

  @Post('condemnation-committee')
  @RequirePermission(PURCHASE.settingsManage)
  addMember(@ReqCtx() ctx: RequestContext, @Body() body: CommitteeMemberDto) {
    return this.condemnations.addMember(ctx, body);
  }

  @Delete('condemnation-committee/:id')
  @RequirePermission(PURCHASE.settingsManage)
  removeMember(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.condemnations.removeMember(ctx, id);
  }

  @Put('condemnation-committee/signatures')
  @RequirePermission(PURCHASE.settingsManage)
  signatures(@ReqCtx() ctx: RequestContext, @Body() body: { signatures?: unknown }) {
    const n = z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .nullable()
      .safeParse(body.signatures ?? null);
    if (!n.success)
      throw new DomainError('validation-failed', 'From 1 to 20, or empty for all', { status: 400 });
    return this.condemnations.setSignatures(ctx, n.data);
  }

  @Get('condemnations')
  @AuthenticatedOnly()
  listCondemnations(@ReqCtx() ctx: RequestContext, @Query() q: StockDocQueryDto) {
    return this.condemnations.list(ctx, q);
  }

  @Get('condemnation-candidates')
  @RequirePermission(PURCHASE.assetManage)
  candidates(@ReqCtx() ctx: RequestContext) {
    return this.condemnations.candidates(ctx);
  }

  @Post('condemnations')
  @RequirePermission(PURCHASE.assetManage)
  propose(@ReqCtx() ctx: RequestContext, @Body() body: CondemnationDto) {
    return this.condemnations.create(ctx, body);
  }

  @Get('condemnations/:id')
  @AuthenticatedOnly()
  getCondemnation(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.condemnations.get(ctx, id);
  }

  @Put('condemnations/:id')
  @RequirePermission(PURCHASE.assetManage)
  updateCondemnation(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CondemnationDto,
  ) {
    return this.condemnations.update(ctx, id, body);
  }

  @Post('condemnations/:id/submit')
  @RequirePermission(PURCHASE.assetManage)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.condemnations.submit(ctx, id);
  }

  @Post('condemnations/:id/sign')
  @ApiOperation({ summary: 'A condemnation committee member signs the recommendation' })
  @AuthenticatedOnly()
  sign(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.condemnations.sign(ctx, id);
  }

  @Post('condemnations/:id/decide')
  @ApiOperation({ summary: 'Approve (written off), reject, or send back' })
  @AuthenticatedOnly()
  decide(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CondemnationDecisionDto,
  ) {
    return this.condemnations.decide(ctx, id, body);
  }

  @Post('condemnations/:id/cancel')
  @RequirePermission(PURCHASE.assetManage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.condemnations.cancel(ctx, id, body);
  }

  @Post('condemnations/:id/dispose')
  @RequirePermission(PURCHASE.assetManage)
  dispose(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DisposalDto) {
    return this.condemnations.dispose(ctx, id, body);
  }

  @Get('condemnations/:id/pdf')
  @AuthenticatedOnly()
  async condemnationPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, save, await this.condemnations.pdf(ctx, id));
  }
}
