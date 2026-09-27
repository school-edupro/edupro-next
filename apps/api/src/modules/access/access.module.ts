import { Global, Module } from '@nestjs/common';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { AssignmentsService } from './assignments.service';
import { DelegationsService } from './delegations.service';
import { MembershipsService } from './memberships.service';
import { RolesService } from './roles.service';

@Global()
@Module({
  controllers: [AccessController],
  providers: [
    AccessService,
    ScopePolicy,
    RolesService,
    AssignmentsService,
    DelegationsService,
    MembershipsService,
  ],
  exports: [AccessService, ScopePolicy],
})
export class AccessModule {}
