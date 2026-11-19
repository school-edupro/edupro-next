import { Badge, Card, PageHeader } from '@edupro/ui';
import { getMe } from '@/lib/api';
import { myApprovals } from '@/lib/approvals';

/** Everything waiting for the signed-in user, grouped, each linking to its approval screen. */
export default async function MyApprovalsPage() {
  const me = await getMe();
  const { total, groups, unavailable } = await myApprovals(me.permissions);
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
      {unavailable.length ? (
        <p className="ep-field__help" role="status">
          Could not be read just now: {unavailable.join(', ')}. Try again in a moment.
        </p>
      ) : null}
      {groups.length ? (
        <div className="ep-approvals">
          {groups.map((g) => (
            <Card key={g.kind}>
              <div className="ep-approvals__head">
                <h2 className="ep-approvals__title">
                  {g.title} <Badge tone={g.count ? 'warning' : 'neutral'}>{String(g.count)}</Badge>
                </h2>
                {g.href ? (
                  <a className="ep-btn ep-btn--primary ep-btn--sm" href={g.href}>
                    Open
                  </a>
                ) : null}
              </div>
              {g.help ? <p className="ep-field__help">{g.help}</p> : null}
              {g.items.length ? (
                <ul className="ep-approvals__list">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      {it.href ? (
                        <a
                          href={it.href}
                          {...(it.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        >
                          {it.title}
                          {it.external ? (
                            <span className="ep-sr-only"> (staff app, opens in a new tab)</span>
                          ) : null}
                        </a>
                      ) : (
                        <span>{it.title}</span>
                      )}
                      <span className="ep-field__help">
                        {it.detail}
                        {it.detail && it.since ? ' · ' : ''}
                        {it.since ? new Date(it.since).toLocaleDateString('en-IN') : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {g.items.length < g.count ? (
                <p className="ep-field__help">
                  {`Showing ${String(g.items.length)} of ${String(g.count)}.`}
                  {g.href ? ' Open the group for the rest.' : ''}
                </p>
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
