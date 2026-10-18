/**
 * The bar across a portal the school opened as someone (0183, docs/design/31-portal-view-as.md): whose
 * portal, by whom, until when, view only or acting, and End (which signs out here).
 */
export function ViewAsBar({
  name,
  by,
  until,
  mode,
  endAction = '/api/auth/end-view',
}: {
  name: string;
  by: string;
  until: string;
  mode: 'full' | 'view' | 'act';
  endAction?: string;
}) {
  const time = new Date(until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="ep-viewas" role="status">
      <span>
        <strong>{mode === 'view' ? 'Viewing as' : 'Acting as'} {name}</strong> · opened by {by} ·
        until {time}
        {mode === 'view' ? ' · view only, nothing can be sent' : ' · payments are not available'}
      </span>
      <form action={endAction} method="post">
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          End
        </button>
      </form>
    </div>
  );
}
