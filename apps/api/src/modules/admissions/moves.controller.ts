import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import {
  MoveAcceptDto,
  MoveCloseDto,
  MoveRequestDto,
  MovesExportDto,
  MovesQueryDto,
} from './moves.dto';
import { AdmissionMovesService } from './moves.service';

export const ADMISSION_MOVE = 'admissions.application.move';

/**
 * Moving a registration to the other school of the group (docs/design/64): the first school asks with a
 * reason, the other accepts it into a session and class (a fresh registration, the money carried over)
 * or refuses it. Both schools see the move; asking, accepting and refusing need the move right.
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionMovesController {
  constructor(private readonly svc: AdmissionMovesService) {}

  @Get('moves/targets')
  @ApiOperation({ summary: "The group's other schools a registration may move to" })
  @RequirePermission(ADMISSION_MOVE)
  targets(@ReqCtx() ctx: RequestContext) {
    return this.svc.targets(ctx);
  }

  @Get('moves')
  @ApiOperation({ summary: 'Moves between schools: incoming, outgoing or both' })
  @RequirePermission(ADMISSIONS.applicationView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: MovesQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Get('moves/export')
  @ApiOperation({ summary: 'The register of moves (Excel or PDF, base64)' })
  @RequirePermission(ADMISSIONS.applicationView)
  export(@ReqCtx() ctx: RequestContext, @Query() q: MovesExportDto) {
    return this.svc.export(ctx, q);
  }

  @Get('moves/:id')
  @RequirePermission(ADMISSIONS.applicationView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Get('moves/:id/options')
  @ApiOperation({
    summary: "The receiving school's sessions and classes, the same class suggested",
  })
  @RequirePermission(ADMISSION_MOVE)
  options(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.options(ctx, id);
  }

  @Post('registrations/:id/move')
  @ApiOperation({ summary: 'Ask to move a registration to another school of the group' })
  @RequirePermission(ADMISSION_MOVE, {
    description:
      'Move a registration to another school of the group, and accept or refuse registrations moved here',
  })
  request(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveRequestDto) {
    return this.svc.request(ctx, id, dto);
  }

  @Post('moves/:id/preview')
  @ApiOperation({
    summary: 'What accepting into a session and class would do (fee, money, answers to ask)',
  })
  @RequirePermission(ADMISSION_MOVE)
  preview(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveAcceptDto) {
    return this.svc.preview(ctx, id, dto);
  }

  @Post('moves/:id/accept')
  @ApiOperation({ summary: 'Accept a move: a fresh registration here, the old one cancelled' })
  @RequirePermission(ADMISSION_MOVE)
  accept(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveAcceptDto) {
    return this.svc.accept(ctx, id, dto);
  }

  @Post('moves/:id/refuse')
  @RequirePermission(ADMISSION_MOVE)
  refuse(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveCloseDto) {
    return this.svc.close(ctx, id, 'refused', dto.note);
  }

  @Post('moves/:id/withdraw')
  @RequirePermission(ADMISSION_MOVE)
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: MoveCloseDto) {
    return this.svc.close(ctx, id, 'withdrawn', dto.note);
  }
}
