import { Badge, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { GroupNew } from '@/components/comms/GroupNew';
import { apiFetch, getMe } from '@/lib/api';
import { KIND_LABEL, type Group } from '@/lib/comms';
import { loadPickers } from '@/lib/comms-data';

/** Communication groups (v2): student, employee, student + teacher and outside-contact groups. */
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const [me, groups] = await Promise.all([
    getMe(),
    apiFetch<{ data: Group[] }>('/comms/groups').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('comms.group.manage');
  const pickers = canManage && sp.new ? await loadPickers() : null;
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Groups"
        description="Student, employee, student + teacher and outside-contact groups, kept by hand, uploaded from Excel or following a rule."
        actions={
          canManage && !sp.new ? (
            <a className="ep-btn ep-btn--primary" href="/comms/groups?new=1">
              New group
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />
      {pickers ? (
        <Card title="New group" style={{ marginBottom: 'var(--sp-4)' }}>
          <GroupNew
            options={pickers.options}
            classes={pickers.classes}
            sections={pickers.sections}
          />
        </Card>
      ) : null}
      <Card>
        {groups.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="ep-table">
              <caption className="ep-sr-only">Groups</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Members</th>
                  <th scope="col">How</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <a href={`/comms/groups/${g.id}`}>{g.name}</a>
                      {g.description ? <div className="ep-field__help">{g.description}</div> : null}
                    </td>
                    <td>{KIND_LABEL[g.kind]}</td>
                    <td>{g.members}</td>
                    <td>
                      <Badge tone={g.mode === 'rule' ? 'info' : 'neutral'}>
                        {g.mode === 'rule' ? 'Rule' : 'By hand / Excel'}
                      </Badge>
                    </td>
                    <td>{new Date(g.updatedAt).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No groups yet.</p>
        )}
      </Card>
    </>
  );
}
