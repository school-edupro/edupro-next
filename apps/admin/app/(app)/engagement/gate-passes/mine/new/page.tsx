import { Card, PageHeader } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { StaffPassForm } from '@/components/gate-passes/StaffPassForm';
import { getMe } from '@/lib/api';
import { today } from '@/lib/appointments';

/** An employee asks for their own gate pass (RGP / NRGP). */
export default async function NewStaffPassPage() {
  const me = await getMe();
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="Apply for a gate pass"
        description="RGP: you go out on work and come back the same day. NRGP: you do not come back today. List anything you carry out of the school."
      />
      <GatePassNav current="/engagement/gate-passes/mine" permissions={me.permissions} />
      <Card>
        <StaffPassForm today={today()} />
      </Card>
    </>
  );
}
