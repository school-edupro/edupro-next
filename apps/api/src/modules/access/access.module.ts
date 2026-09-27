import { Global, Module } from '@nestjs/common';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { AssignmentsService } from './assignments.service';
import { BreakGlassService } from './break-glass.service';
import { ImpersonationService } from './impersonation.service';
import { AccessSecurityController } from './security.controller';
import { DelegationsService } from './delegations.service';
import { MembershipsService } from './memberships.service';
import { RolesService } from './roles.service';

@Global()
@Module({
  controllers: [AccessController, AccessSecurityController],
  providers: [
    AccessService,
    ScopePolicy,
    RolesService,
    AssignmentsService,
    DelegationsService,
    MembershipsService,
    ImpersonationService,
    BreakGlassService,
    AuditService,
  ],
  exports: [AccessService, ScopePolicy],
})
export class AccessModule {}
