import { Badge, Card, PageHeader } from '@edupro/ui';
import { getMe } from '@/lib/api';
import { myApprovals } from '@/lib/approvals';

/** Everything waiting for the signed-in user, grouped, each linking to its approval screen. */
export default async function MyApprovalsPage() {
  const me = await getMe();
  const groups = await myApprovals(me.permissions, true);
  const total = groups.reduce((n, g) => n + g.count, 0);
  return (
    <>
      <PageHeader
        kicker="Approvals"
        title="My approvals"
        description={
          total
            ? `${String(total)} waiting for you. Open a group to decide.`
            : 'Nothing is waiting for you right now.'
        }
      />
      {groups.length ? (
        <div className="ep-approvals">
          {groups.map((g) => (
            <Card key={g.key}>
              <div className="ep-approvals__head">
                <h2 className="ep-approvals__title">
                  {g.title} <Badge tone={g.count ? 'warning' : 'neutral'}>{String(g.count)}</Badge>
                </h2>
                <a className="ep-btn ep-btn--primary ep-btn--sm" href={g.href}>
                  Open
                </a>
              </div>
              <p className="ep-field__help">{g.help}</p>
              {g.items.length ? (
                <ul className="ep-approvals__list">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <a href={it.href}>{it.title}</a>
                      <span className="ep-field__help">
                        {it.detail}
                        {it.since ? ` · ${new Date(it.since).toLocaleDateString('en-IN')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card>You do not approve anything in this school.</Card>
      )}
    </>
  );
}
