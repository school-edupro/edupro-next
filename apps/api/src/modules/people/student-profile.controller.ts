import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  IdSchema,
  NextNumbersQueryDto,
  ProfileQueryDto,
  QuickAddDto,
  UpdateProfileDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentProfileService } from './student-profile.service';

const idOf = (id: string): string => {
  if (!IdSchema.safeParse(id).success) throw new DomainError('not-found', 'Student not found');
  return id;
};

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class StudentProfileController {
  constructor(private readonly profile: StudentProfileService) {}

  @Get('profile/catalogue')
  @ApiOperation({ summary: 'Student profile sections, fields, drop-down options and geography' })
  @RequirePermission(PEOPLE.studentView)
  catalogue(@ReqCtx() ctx: RequestContext) {
    return this.profile.catalogue(ctx);
  }

  @Get('profile/next-numbers')
  @ApiOperation({ summary: 'Suggested next admission number and roll number for quick add' })
  @RequirePermission(PEOPLE.studentCreate)
  nextNumbers(@ReqCtx() ctx: RequestContext, @Query() q: NextNumbersQueryDto) {
    return this.profile.nextNumbers(ctx, q.classSectionId);
  }

  @Post('profile/quick-add')
  @ApiOperation({ summary: 'Quick student add: minimum fields, enrolled in a section' })
  @RequirePermission(PEOPLE.studentCreate)
  quickAdd(@ReqCtx() ctx: RequestContext, @Body() body: QuickAddDto) {
    return this.profile.quickAdd(ctx, body);
  }

  @Get('students/:id/profile')
  @ApiOperation({
    summary:
      'Every profile field of a student; Aadhaar, PAN and bank account masked unless permitted',
  })
  @RequirePermission(PEOPLE.studentView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: ProfileQueryDto) {
    return this.profile.get(ctx, idOf(id), q.academicYearId);
  }

  @Patch('students/:id/profile')
  @ApiOperation({ summary: 'Change profile fields; only the keys sent change, null clears' })
  @RequirePermission(PEOPLE.studentEdit)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateProfileDto) {
    return this.profile.update(ctx, idOf(id), body);
  }
}
