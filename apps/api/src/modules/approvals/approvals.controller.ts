import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import {
  ReqCtx,
  type ContextualRequest,
  type RequestContext,
} from '../../common/http/request-context';
import { ApprovalsService } from './approvals.service';

const InboxQuerySchema = z.object({
  kind: z.string().trim().max(40).optional(),
  /** counts: the counts alone, no items (a header badge) */
  view: z.enum(['items', 'counts']).optional(),
});
class ApprovalsInboxQueryDto extends createZodDto(InboxQuerySchema) {}

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  /** why (a reject needs one for most kinds) */
  reason: z.string().trim().max(500).optional(),
});
class ApprovalDecisionDto extends createZodDto(DecisionSchema) {}

/** docs/design/100 phase D: a step of an item decided item by item, with its form's body */
const ActSchema = z.object({
  step: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,30}$/),
  body: z.record(z.string(), z.unknown()).default({}),
});
class ApprovalActDto extends createZodDto(ActSchema) {}

/**
 * The approvals inbox (docs/design/89 §5.4). Signed-in only here: each kind's own routes, called as the person, decide
 * what they may list and decide (their permissions, scope, segregation of duties, second factor and audit).
 */
@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('inbox')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Everything waiting for my decision, every kind, one shape' })
  inbox(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Query() q: ApprovalsInboxQueryDto,
  ) {
    return this.approvals.inbox(ctx, req, q.kind, q.view);
  }

  @Get(':kind/:id')
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      "One waiting item and its record for the app's Details screen (docs/design/100), read through its own routes",
  })
  detail(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.approvals.detail(ctx, req, kind, id);
  }

  @Post(':kind/:id/act')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'A step of an item decided item by item (inspect, sign, clear, accept, save, submit …) through its own route',
  })
  act(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: ApprovalActDto,
  ) {
    return this.approvals.act(ctx, req, kind, id, body.step, body.body);
  }

  @Get(':kind/:id/files/:fileId')
  @AuthenticatedOnly()
  @ApiOperation({ summary: "A file the waiting item's record names: its download address" })
  file(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    if (!/^\d{1,18}$/.test(fileId)) return { download: null };
    return this.approvals.file(ctx, req, kind, id, fileId);
  }

  @Post(':kind/:id/decision')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Approve or reject one item through its own route' })
  decide(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: ApprovalDecisionDto,
  ) {
    return this.approvals.decide(ctx, req, kind, id, body.decision, body.reason ?? null);
  }
}
