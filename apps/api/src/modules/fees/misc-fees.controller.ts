import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FeeDocumentsService } from './fee-documents.service';
import { FEES } from './fees.dto';
import {
  AnnounceMiscFeeDto,
  CollectMiscFeeDto,
  DecideMiscRequestDto,
  ListMiscFeesQueryDto,
  MiscFeeChangeSchema,
  MiscReceiptRequestDto,
  MiscSheetDto,
  type MiscFeeChangeDto,
} from './misc-fees.dto';
import { MiscFeesService } from './misc-fees.service';

/** Misc fees announced to pupils: announce, change, collect at the counter, take a receipt back. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees/misc-fees')
export class MiscFeesController {
  constructor(
    private readonly misc: MiscFeesService,
    private readonly papers: FeeDocumentsService,
  ) {}

  @Get('heads')
  @ApiOperation({ summary: 'The heads a misc fee can be raised under' })
  @RequirePermission(FEES.miscView)
  heads(@ReqCtx() ctx: RequestContext) {
    return this.misc.heads(ctx);
  }

  @Get('mine')
  @ApiOperation({ summary: "The misc fees announced for one's own children" })
  @RequirePermission(FEES.familyView)
  mine(@ReqCtx() ctx: RequestContext) {
    return this.misc.mine(ctx);
  }

  @Get('sheet-format')
  @ApiOperation({ summary: 'The Excel sheet to fill for an announcement by upload' })
  @RequirePermission(FEES.miscView)
  async sheetFormat() {
    const f = await this.misc.sheetFormat();
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Post('sheet')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read the rows of an uploaded sheet (admission no., amount, last date)',
  })
  @RequirePermission(FEES.miscPost)
  sheet(@Body() body: MiscSheetDto) {
    return this.misc.readSheet(body.contentBase64);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Misc fee requests, waiting first' })
  @RequirePermission(FEES.miscView)
  requests(@ReqCtx() ctx: RequestContext, @Query('status') status?: string) {
    const s = ['pending', 'approved', 'rejected'].includes(status ?? '')
      ? (status as 'pending' | 'approved' | 'rejected')
      : undefined;
    return this.misc.requests(ctx, s);
  }

  @Post('requests/:id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject on the page (no approval level in force)' })
  @RequirePermission(FEES.adjustmentApprove)
  decide(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideMiscRequestDto,
  ) {
    return this.misc.decide(ctx, id, body.outcome, body.note);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'What a pupil can pay at the counter, and their misc receipts' })
  @RequirePermission(FEES.miscView)
  forStudent(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.misc.forStudent(ctx, studentId);
  }

  @Get('staff')
  @ApiOperation({ summary: 'Staff members found by name, code or mobile (the counter)' })
  @RequirePermission(FEES.miscView)
  staffSearch(@ReqCtx() ctx: RequestContext, @Query('q') q?: string) {
    return this.misc.staffSearch(ctx, q ?? '');
  }

  @Get('employee/:employeeId')
  @ApiOperation({
    summary: 'The misc fees of a staff member and their misc receipts (the counter)',
  })
  @RequirePermission(FEES.miscView)
  forEmployee(@ReqCtx() ctx: RequestContext, @Param('employeeId') employeeId: string) {
    return this.misc.forEmployee(ctx, employeeId);
  }

  @Post('collect')
  @ApiOperation({ summary: 'Receive misc fees of a pupil at the counter' })
  @RequirePermission(FEES.miscPost)
  collect(@ReqCtx() ctx: RequestContext, @Body() body: CollectMiscFeeDto) {
    return this.misc.collect(ctx, body);
  }

  @Get('receipts/:id/receipt-view')
  @ApiOperation({ summary: 'A misc receipt as it prints' })
  @RequirePermission(FEES.miscView)
  receiptView(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.papers.miscReceiptView(ctx, id);
  }

  @Post('receipts/:id/request')
  @ApiOperation({ summary: 'Ask to cancel, bounce or refund a misc receipt' })
  @RequirePermission(FEES.miscPost)
  receiptRequest(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: MiscReceiptRequestDto,
  ) {
    return this.misc.requestReceipt(ctx, id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Misc fees of the year' })
  @RequirePermission(FEES.miscView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListMiscFeesQueryDto) {
    return this.misc.list(ctx, q);
  }

  @Post()
  @ApiOperation({ summary: 'Announce a misc fee (goes for approval)' })
  @RequirePermission(FEES.miscPost)
  announce(@ReqCtx() ctx: RequestContext, @Body() body: AnnounceMiscFeeDto) {
    return this.misc.announce(ctx, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A misc fee with its pupils and requests' })
  @RequirePermission(FEES.miscView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.misc.get(ctx, id);
  }

  @Post(':id/changes')
  @ApiOperation({ summary: 'Ask for a change: last date, a pupil, more pupils, close' })
  @RequirePermission(FEES.miscPost)
  change(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MiscFeeChangeSchema)) body: MiscFeeChangeDto,
  ) {
    return this.misc.requestChange(ctx, id, body);
  }
}
