import type { IndentStep } from '@/lib/purchase';

/**
 * Who a purchase approval level waits with, or who decided it. A level that needs all its people
 * shows each of them, ticked once they approved, and how many have (docs/design/83).
 */
export function StepApprovers({ s }: { s: IndentStep }) {
  if (s.need === 'all' && s.status === 'pending') {
    const done = new Set((s.approvedBy ?? []).map((a) => a.id));
    return (
      <>
        <span>
          {s.assignees.map((a, i) => (
            <span key={a.id}>
              {i ? ', ' : ''}
              {done.has(a.id) ? '✓ ' : ''}
              {a.name}
            </span>
          ))}
        </span>
        <span className="ep-mr-col__desc">
          All of them must approve · {String(done.size)} of {String(s.assignees.length)} have
        </span>
      </>
    );
  }
  if (s.actedBy) return <>{s.actedBy}</>;
  return <>{s.assignees.length ? s.assignees.map((a) => a.name).join(', ') : 'Nobody'}</>;
}
