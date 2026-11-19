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

const InboxQuerySchema = z.object({ kind: z.string().trim().max(40).optional() });
class ApprovalsInboxQueryDto extends createZodDto(InboxQuerySchema) {}

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  /** why (a reject needs one for most kinds) */
  reason: z.string().trim().max(500).optional(),
});
class ApprovalDecisionDto extends createZodDto(DecisionSchema) {}

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
    return this.approvals.inbox(ctx, req, q.kind);
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
