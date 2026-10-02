import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { SectionRollService } from './section-roll.service';

const Id = z.string().regex(/^\d{1,18}$/);
export class RenumberDto extends createZodDto(
  z.object({
    rolls: z
      .array(z.object({ studentId: Id, rollNo: z.number().int().min(1).max(999) }))
      .min(1)
      .max(200),
  }),
) {}
export class MoveSectionDto extends createZodDto(
  z.object({ studentId: Id, toSectionId: Id, rollNo: z.number().int().min(1).max(999).optional() }),
) {}

@ApiTags('people')
@ApiBearerAuth()
@Controller('people/sections')
export class SectionRollController {
  constructor(private readonly svc: SectionRollService) {}

  @Get()
  @ApiOperation({ summary: 'Sections of the working year this user may renumber' })
  @RequirePermission(PEOPLE.rollNoManage)
  sections(@ReqCtx() ctx: RequestContext) {
    return this.svc.sections(ctx);
  }

  @Get(':id/roll')
  @ApiOperation({
    summary: 'Students of a section with roll numbers, and the other sections of its class',
  })
  @RequirePermission(PEOPLE.studentView)
  section(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.section(ctx, id);
  }

  @Put(':id/roll')
  @ApiOperation({
    summary: 'Renumber roll numbers of a section (class teachers: their own section)',
  })
  @RequirePermission(PEOPLE.rollNoManage, {
    description: 'Renumber roll numbers of a section',
  })
  renumber(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RenumberDto) {
    return this.svc.renumber(ctx, id, body.rolls);
  }

  @Post(':id/move')
  @ApiOperation({ summary: 'Move a student to another section of the same class (fees unchanged)' })
  @RequirePermission(PEOPLE.enrolmentManage)
  move(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: MoveSectionDto) {
    return this.svc.move(ctx, id, body);
  }
}
