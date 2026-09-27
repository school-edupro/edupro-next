/**
 * OpenTelemetry bootstrap (S5-04). Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set, so local runs and
 * tests pay nothing. Must be imported before Nest and Fastify so the auto-instrumentations can patch them.
 */
import type { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

export async function startTracing(serviceName: string): Promise<NodeSDK | null> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  const [{ NodeSDK: Sdk }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
    ]);
  sdk = new Sdk({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-pino': { enabled: true },
      }),
    ],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk?.shutdown());
  return sdk;
}

/** Trace and span ids for log correlation; empty when tracing is off. */
export function traceContext(): { traceId?: string; spanId?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dependency resolved lazily
    const { trace } = require('@opentelemetry/api') as typeof import('@opentelemetry/api');
    const span = trace.getActiveSpan();
    if (!span) return {};
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  } catch {
    return {};
  }
}
