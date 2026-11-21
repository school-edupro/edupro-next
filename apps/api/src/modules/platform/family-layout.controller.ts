import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  FamilyAudienceSchema,
  FamilyLayoutDto,
  FamilyLayoutKindDto,
  FamilyShortcutsDto,
} from './family-layout.dto';
import { FamilyLayoutService } from './family-layout.service';
import { PLATFORM } from './platform.permissions';

const audienceOf = (a: string) => {
  const r = FamilyAudienceSchema.safeParse(a);
  if (!r.success)
    throw new DomainError('not-found', 'No such layout (student or parent)', { status: 404 });
  return r.data;
};

/**
 * The family app's layout kept by the school (0407, docs/design/90): the office's draft, preview and publish on System
 * settings (`platform/family-app-layout`, the settings rights); a student's or parent's own layout and Home shortcuts
 * (`me/app-layout`).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller()
export class FamilyLayoutController {
  constructor(private readonly layouts: FamilyLayoutService) {}

  // ---- students and parents
  @Get('me/app-layout')
  @ApiOperation({
    summary:
      'My family app layout: tabs, Home shortcuts (mine or the school’s), cards, Academics list',
  })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext, @Query() q: FamilyLayoutKindDto) {
    return this.layouts.mine(ctx, q.kind);
  }

  @Put('me/app-layout/shortcuts')
  @ApiOperation({ summary: 'My own Home shortcuts (4 to 12 screens I can open)' })
  @AuthenticatedOnly()
  saveMine(
    @ReqCtx() ctx: RequestContext,
    @Query() q: FamilyLayoutKindDto,
    @Body() dto: FamilyShortcutsDto,
  ) {
    return this.layouts.saveMine(ctx, q.kind, dto.shortcuts);
  }

  @Delete('me/app-layout/shortcuts')
  @ApiOperation({ summary: 'Back to the school’s Home shortcuts' })
  @AuthenticatedOnly()
  resetMine(@ReqCtx() ctx: RequestContext, @Query() q: FamilyLayoutKindDto) {
    return this.layouts.resetMine(ctx, q.kind);
  }

  // ---- System settings
  @Get('platform/family-app-layout')
  @ApiOperation({
    summary: 'The family app layouts (students, parents): draft, published, catalogue',
  })
  @RequirePermission(PLATFORM.settingsView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.layouts.setup(ctx);
  }

  @Put('platform/family-app-layout/:audience')
  @ApiOperation({ summary: 'Save the draft layout (families get it when it is published)' })
  @RequirePermission(PLATFORM.settingsEdit)
  save(
    @ReqCtx() ctx: RequestContext,
    @Param('audience') audience: string,
    @Body() dto: FamilyLayoutDto,
  ) {
    return this.layouts.saveDraft(ctx, audienceOf(audience), dto);
  }

  @Post('platform/family-app-layout/:audience/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft layout to the families' })
  @RequirePermission(PLATFORM.settingsEdit)
  publish(@ReqCtx() ctx: RequestContext, @Param('audience') audience: string) {
    return this.layouts.publish(ctx, audienceOf(audience));
  }

  @Post('platform/family-app-layout/:audience/discard')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discard the draft: back to the published layout' })
  @RequirePermission(PLATFORM.settingsEdit)
  discard(@ReqCtx() ctx: RequestContext, @Param('audience') audience: string) {
    return this.layouts.discard(ctx, audienceOf(audience));
  }
}
