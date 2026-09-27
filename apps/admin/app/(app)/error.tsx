'use client';
import { Alert, Button } from '@edupro/ui';

/**
 * Page-level error boundary for the signed-in area: an API refusal (for example a direct URL to a
 * screen the role cannot see) renders as a notice with a way back instead of a blank crash.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const denied = /Missing permission|permission-denied|scope-denied/i.test(error.message);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)', maxWidth: 640 }}>
      <Alert
        tone={denied ? 'warning' : 'danger'}
        title={denied ? 'You do not have permission to view this page.' : 'Something went wrong.'}
      >
        <span>{error.message}</span>
      </Alert>
      <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
        <a className="ep-btn ep-btn--secondary" href="/">
          Dashboard
        </a>
        {!denied ? (
          <Button type="button" variant="ghost" onClick={() => reset()}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
