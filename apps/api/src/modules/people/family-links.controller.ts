import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { FamilyLinksService } from './family-links.service';
import { FamilyLinkDto, FamilyLinkUndoDto, FamilyPreviewQueryDto, IdSchema } from './people.dto';
import { PEOPLE } from './people.permissions';

const idOf = (id: string) => {
  if (!IdSchema.safeParse(id).success) throw new DomainError('not-found', 'Student not found');
  return id;
};

/** Link families (0426): one father / mother record for two siblings, so a parent's login sees both. */
@ApiTags('people')
@ApiBearerAuth()
@Controller('people/students/:id/family-link')
export class FamilyLinksController {
  constructor(private readonly svc: FamilyLinksService) {}

  @Get()
  @ApiOperation({
    summary:
      "A student and its sibling (the Sibling section's, or ?sibling=): each child's father and mother record and what to keep",
  })
  @RequirePermission(PEOPLE.guardianEdit)
  preview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: FamilyPreviewQueryDto,
  ) {
    return this.svc.preview(ctx, idOf(id), q.sibling);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Link the families: per relation keep this child's record, the sibling's, or leave them apart",
  })
  @RequirePermission(PEOPLE.guardianEdit)
  link(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: FamilyLinkDto) {
    return this.svc.link(ctx, idOf(id), body);
  }

  @Post('undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a Link families: each moved child back on its own record' })
  @RequirePermission(PEOPLE.guardianEdit)
  undo(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: FamilyLinkUndoDto) {
    return this.svc.undo(ctx, idOf(id), body.batchId);
  }
}
