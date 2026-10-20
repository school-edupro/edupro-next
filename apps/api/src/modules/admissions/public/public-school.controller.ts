import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/auth/decorators';
import { PublicSchoolService } from './public-school.service';
import { PublicThrottle, PublicThrottleGuard } from './public-throttle.guard';

/** The school's own band on its public pages: open to anyone, read-only and throttled. */
@ApiTags('public')
@Controller('public/schools')
@UseGuards(PublicThrottleGuard)
export class PublicSchoolController {
  constructor(private readonly svc: PublicSchoolService) {}

  @Get(':schoolCode')
  @Public()
  @PublicThrottle(120)
  @ApiOperation({ summary: 'The school as its public pages show it: name, logo, address, contact' })
  profile(@Param('schoolCode') schoolCode: string) {
    return this.svc.profile(schoolCode);
  }

  @Get(':schoolCode/logo')
  @Public()
  @PublicThrottle(120)
  @ApiOperation({ summary: 'The school’s logo (base64)' })
  logo(@Param('schoolCode') schoolCode: string) {
    return this.svc.logo(schoolCode);
  }
}
