import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ENGAGEMENT } from './engagement.dto';
import {
  BulkDecideDto,
  DecideItemsDto,
  InboxQueryDto,
  PORTAL,
  SavePortalPolicyDto,
  SubmitPortalChangesDto,
} from './portal-profile.dto';
import { PortalProfileService } from './portal-profile.service';

/** Portal profile, its policy and the profile approvals inbox (2026-10-01). */
@ApiTags('engagement')
@ApiBearerAuth()
@Controller()
export class PortalProfileController {
  constructor(private readonly portal: PortalProfileService) {}

  // ---- policy --------------------------------------------------------------------------------------
  @Get('people/portal-profile/policy')
  @ApiOperation({
    summary: 'What parents and students see and change, proofs, update window and approvers',
  })
  @RequirePermission(PORTAL.manage, {
    description:
      'Choose what parents and students see and change on the portal profile, proofs, window and approvers',
  })
  policy(@ReqCtx() ctx: RequestContext) {
    return this.portal.policy(ctx);
  }

  @Put('people/portal-profile/policy')
  @RequirePermission(PORTAL.manage)
  savePolicy(@ReqCtx() ctx: RequestContext, @Body() dto: SavePortalPolicyDto) {
    return this.portal.savePolicy(ctx, dto);
  }

  // ---- family --------------------------------------------------------------------------------------
  @Get('engagement/mine/profile/:studentId')
  @ApiOperation({ summary: 'My child’s profile as the school shows it on the portal' })
  @RequirePermission(ENGAGEMENT.familyView)
  profile(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.portal.portalProfile(ctx, studentId);
  }

  @Post('engagement/mine/profile/:studentId/changes')
  @ApiOperation({
    summary: 'Change profile fields: applied at once or sent for approval, with proof documents',
  })
  @RequirePermission(ENGAGEMENT.changeCreate)
  submit(
    @ReqCtx() ctx: RequestContext,
    @Param('studentId') studentId: string,
    @Body() dto: SubmitPortalChangesDto,
  ) {
    return this.portal.submit(ctx, studentId, dto);
  }

  @Get('engagement/mine/profile/:studentId/requests')
  @RequirePermission(ENGAGEMENT.familyView)
  requests(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.portal.myRequests(ctx, studentId);
  }

  @Post('engagement/mine/change-requests/:id/cancel')
  @RequirePermission(ENGAGEMENT.changeCreate)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.portal.cancel(ctx, id);
  }

  @Get('engagement/mine/profile/:studentId/photo/:party')
  @RequirePermission(ENGAGEMENT.familyView)
  photo(
    @ReqCtx() ctx: RequestContext,
    @Param('studentId') studentId: string,
    @Param('party') party: string,
  ) {
    return this.portal.photo(ctx, studentId, party);
  }

  @Post('engagement/mine/profile/:studentId/print')
  @ApiOperation({ summary: 'Queue the profile PDF with the fields this portal shows' })
  @RequirePermission(ENGAGEMENT.familyView)
  print(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.portal.requestPrint(ctx, studentId);
  }

  @Get('engagement/mine/exports/:id')
  @RequirePermission(ENGAGEMENT.familyView)
  exportStatus(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.portal.exportStatus(ctx, id);
  }

  // ---- approvals -----------------------------------------------------------------------------------
  @Get('engagement/profile-approvals')
  @ApiOperation({
    summary: 'Profile changes awaiting me (box=mine), all pending or decided, with filters',
  })
  @RequirePermission(PORTAL.approve, {
    description: 'Approve or reject profile changes routed to me (my role, my name or my class)',
  })
  inbox(@ReqCtx() ctx: RequestContext, @Query() q: InboxQueryDto) {
    return this.portal.inbox(ctx, q);
  }

  @Post('engagement/profile-approvals/:id/decide')
  @ApiOperation({ summary: 'Accept or refuse a request, field by field' })
  @RequirePermission(PORTAL.approve)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DecideItemsDto) {
    return this.portal.decide(ctx, id, dto);
  }

  @Get('engagement/profile-approvals/:id/proofs/:fileId')
  @ApiOperation({ summary: 'A signed link to a proof document attached to the request' })
  @RequirePermission(PORTAL.approve)
  proof(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.portal.proofUrl(ctx, id, fileId);
  }

  @Post('engagement/profile-approvals/bulk')
  @ApiOperation({ summary: 'Accept or refuse many requests at once (each is checked on its own)' })
  @RequirePermission(PORTAL.approve)
  bulk(@ReqCtx() ctx: RequestContext, @Body() dto: BulkDecideDto) {
    return this.portal.bulkDecide(ctx, dto);
  }
}
