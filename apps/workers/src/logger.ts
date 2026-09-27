import pino from 'pino';

/** Structured logs with the PII paths of the logging standard redacted (docs/standards/logging-and-pii.md). */
export const createLogger = (level: string) =>
  pino({
    level,
    redact: {
      paths: [
        'to',
        'address',
        'mobile',
        'email',
        'body',
        'payload.mobile',
        'payload.email',
        'payload.body',
        '*.recipient_address',
      ],
      censor: '[redacted]',
    },
  });

export type Logger = ReturnType<typeof createLogger>;

/** Masks an address for logs: keeps the channel-relevant tail so support can correlate without seeing PII. */
export function maskAddress(address: string): string {
  if (address.includes('@')) {
    const [user, domain] = address.split('@');
    return `${(user ?? '').slice(0, 1)}***@${domain ?? ''}`;
  }
  return `***${address.slice(-4)}`;
}
