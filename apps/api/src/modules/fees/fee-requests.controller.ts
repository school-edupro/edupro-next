import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeRequestsService } from './fee-requests.service';
import {
  CollectionSubmitDto,
  CollectionUploadDto,
  DecideChangeDto,
  FEES,
  ListChangeRequestsQueryDto,
  RequestChangeDto,
  SettlementUploadDto,
} from './fees.dto';

const BULK = 'fees.bulk.upload';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Fee changes that wait for approval, and the Excel uploads that feed them (0101). */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/requests')
export class FeeRequestsController {
  constructor(private readonly requests: FeeRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Late-fee waivers, receipt transfers and date corrections of the year' })
  @RequirePermission(FEES.adjustmentRequest)
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListChangeRequestsQueryDto) {
    return { data: await this.requests.list(ctx, q) };
  }

  @Post()
  @ApiOperation({ summary: 'Ask for a late-fee waiver, a receipt transfer or a date correction' })
  @RequirePermission(FEES.adjustmentRequest)
  request(@ReqCtx() ctx: RequestContext, @Body() body: RequestChangeDto) {
    return this.requests.request(ctx, body);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve or reject one request' })
  @RequirePermission(FEES.adjustmentApprove)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideChangeDto) {
    return this.requests.decide(ctx, id, body);
  }

  @Post('batches/:batchId/decide')
  @ApiOperation({ summary: 'Approve or reject every waiting row of one Excel file' })
  @RequirePermission(FEES.adjustmentApprove)
  decideBatch(
    @ReqCtx() ctx: RequestContext,
    @Param('batchId') batchId: string,
    @Body() body: DecideChangeDto,
  ) {
    return this.requests.decideBatch(ctx, batchId, body);
  }

  // ---- settlement dates from Excel ----------------------------------------------------------------
  @Get('settlement-format.xlsx')
  @ApiOperation({ summary: 'The Excel format for settlement and receipt dates' })
  @RequirePermission(BULK, {
    description: 'Upload fee collection or settlement dates from Excel, for approval',
  })
  async settlementFormat(@Res() reply: FastifyReply) {
    const f = await this.requests.settlementFormat();
    reply
      .header('content-type', XLSX)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Post('settlement-upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload settlement / receipt dates; good rows wait for approval' })
  @RequirePermission(BULK)
  settlementUpload(@ReqCtx() ctx: RequestContext, @Body() body: SettlementUploadDto) {
    return this.requests.settlementUpload(ctx, body);
  }

  // ---- collection from Excel ------------------------------------------------------------------------
  @Get('collection-format.xlsx')
  @ApiOperation({ summary: 'The Excel format for bulk fee collection' })
  @RequirePermission(BULK)
  async collectionFormat(@Res() reply: FastifyReply) {
    const f = await this.requests.collectionFormat();
    reply
      .header('content-type', XLSX)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get('collections')
  @ApiOperation({ summary: 'Collection files uploaded this year' })
  @RequirePermission(BULK)
  async collections(@ReqCtx() ctx: RequestContext) {
    return { data: await this.requests.collectionUploads(ctx) };
  }

  @Get('collections/:id')
  @ApiOperation({ summary: 'One collection file with its checked rows' })
  @RequirePermission(BULK)
  collection(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.requests.collectionUpload(ctx, id);
  }

  @Post('collections')
  @ApiOperation({ summary: 'Read and check a collection file; kept as a draft' })
  @RequirePermission(BULK)
  collectionVerify(@ReqCtx() ctx: RequestContext, @Body() body: CollectionUploadDto) {
    return this.requests.collectionVerify(ctx, body);
  }

  @Post('collections/:id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a checked file for approval, or drop it' })
  @RequirePermission(BULK)
  collectionSubmit(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CollectionSubmitDto,
  ) {
    return this.requests.collectionSubmit(ctx, id, body.action, body.reason);
  }

  @Post('collections/:id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve (receipts are posted) or reject a collection file' })
  @RequirePermission(FEES.adjustmentApprove)
  collectionDecide(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideChangeDto,
  ) {
    return this.requests.collectionDecide(ctx, id, body);
  }
}
