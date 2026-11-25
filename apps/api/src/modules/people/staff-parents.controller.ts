import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { IdSchema, StaffParentJoinDto, StaffParentsQueryDto } from './people.dto';
import { PEOPLE } from './people.permissions';
import { StaffParentsService } from './staff-parents.service';

const idOf = (id: string) => {
  if (!IdSchema.safeParse(id).success)
    throw new DomainError('not-found', 'Parent record not found');
  return id;
};

@ApiTags('people')
@ApiBearerAuth()
@Controller('people/staff-parents')
export class StaffParentsController {
  constructor(private readonly svc: StaffParentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Parent records marked School staff, with their students: not joined to the staff login yet (todo), or joined',
  })
  @RequirePermission(PEOPLE.guardianEdit)
  list(@ReqCtx() ctx: RequestContext, @Query() q: StaffParentsQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Post(':guardianId/join')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Join a parent record to the staff member's login it names (move: also when it has a login of its own)",
  })
  @RequirePermission(PEOPLE.guardianEdit)
  join(
    @ReqCtx() ctx: RequestContext,
    @Param('guardianId') guardianId: string,
    @Body() body: StaffParentJoinDto,
  ) {
    return this.svc.join(ctx, idOf(guardianId), body.move);
  }

  @Post(':guardianId/undo')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Undo a join: the login the parent record had before (or none) comes back',
  })
  @RequirePermission(PEOPLE.guardianEdit)
  undo(@ReqCtx() ctx: RequestContext, @Param('guardianId') guardianId: string) {
    return this.svc.undo(ctx, idOf(guardianId));
  }
}
