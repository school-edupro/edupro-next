import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ApprovalDecideDto, ApprovalsQueryDto } from './approvals.dto';
import { AdmissionApprovalsService } from './approvals.service';
import { PointsCheckDto, SendBackDto } from './process.dto';

/**
 * Admission approvers (docs/design/50): open to any signed-in staff; each registration is checked —
 * waiting at a level the user is named in (decide), or decided by them lately (look).
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/approvals')
export class AdmissionApprovalsController {
  constructor(private readonly svc: AdmissionApprovalsService) {}

  @Get()
  @ApiOperation({
    summary: 'Registrations waiting at my levels (or decided by me), with every level remark',
  })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: ApprovalsQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'The review of a registration waiting for me: answers, documents, points, path',
  })
  @AuthenticatedOnly()
  review(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.review(ctx, id);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve, hold or reject at my level, with a remark' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ApprovalDecideDto) {
    return this.svc.decide(ctx, id, dto);
  }

  @Post(':id/send-back')
  @ApiOperation({ summary: 'Send the form back to the family to correct the marked answers' })
  @AuthenticatedOnly()
  sendBack(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SendBackDto) {
    return this.svc.sendBack(ctx, id, dto);
  }

  @Post(':id/points')
  @ApiOperation({
    summary: 'Confirm the merit points, awarding a criterion differently with a reason',
  })
  @AuthenticatedOnly()
  points(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: PointsCheckDto) {
    return this.svc.points(ctx, id, dto);
  }

  @Get(':id/files/:fileId')
  @ApiOperation({ summary: 'A document of the registration (download=1 to save it)' })
  @AuthenticatedOnly()
  async file(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.svc.file(ctx, id, fileId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="document-${fileId}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }
}
