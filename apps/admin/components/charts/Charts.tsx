/**
 * Small charts drawn as plain SVG on the server (no chart library): bars, a line, a ring and progress
 * rows. Colours come from the design tokens through the `ep-chart` classes; every chart carries a text
 * alternative and its numbers are also shown next to it or in a table on the page.
 */
export type ChartTone = 'navy' | 'cyan' | 'success' | 'danger' | 'warning' | 'info' | 'muted';
export interface ChartSeries {
  label: string;
  tone: ChartTone;
}
const compact = (n: number) =>
  Math.abs(n) >= 100000
    ? `${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
      : String(Math.round(n));

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="ep-chart__legend" aria-hidden="true">
      {series.map((s) => (
        <span key={s.label} data-tone={s.tone}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Vertical bars: one group per label, the series side by side or stacked. */
export function BarChart({
  title,
  data,
  series,
  stacked = false,
  valueLabel,
}: {
  title: string;
  data: Array<{ label: string; values: number[] }>;
  series: ChartSeries[];
  stacked?: boolean;
  /** Text over each group (e.g. a percentage); default: none. */
  valueLabel?: (values: number[]) => string;
}) {
  const W = 720;
  const H = 240;
  const left = 44;
  const base = 200;
  const top = 20;
  const max = Math.max(
    1,
    ...data.map((d) => (stacked ? d.values.reduce((a, b) => a + b, 0) : Math.max(...d.values, 0))),
  );
  const step = (W - left - 8) / Math.max(1, data.length);
  const group = Math.min(64, step * 0.72);
  const bar = stacked ? group : group / Math.max(1, series.length);
  const h = (n: number) => ((base - top) * Math.max(0, n)) / max;
  const ticks = [0, 0.5, 1].map((f) => max * f);
  return (
    <figure className="ep-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={title}>
        {ticks.map((v) => (
          <g key={String(v)}>
            <line
              className="ep-chart__grid"
              x1={left}
              x2={W - 4}
              y1={base - h(v)}
              y2={base - h(v)}
              strokeWidth="1"
            />
            <text x={left - 6} y={base - h(v) + 4} textAnchor="end" fontSize="11">
              {compact(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = left + i * step + (step - group) / 2;
          let acc = 0;
          return (
            <g key={d.label}>
              {d.values.map((v, k) => {
                const height = h(v);
                const y = stacked ? base - acc - height : base - height;
                acc += stacked ? height : 0;
                return (
                  <rect
                    key={String(k)}
                    className={`ep-chart-fill--${series[k]?.tone ?? 'navy'}`}
                    x={stacked ? x0 : x0 + k * bar}
                    y={y}
                    width={Math.max(1, bar - (stacked ? 0 : 2))}
                    height={height}
                  >
                    <title>{`${d.label} · ${series[k]?.label ?? ''}: ${v.toLocaleString('en-IN')}`}</title>
                  </rect>
                );
              })}
              {valueLabel ? (
                <text
                  x={x0 + group / 2}
                  y={
                    base -
                    (stacked
                      ? h(d.values.reduce((a, b) => a + b, 0))
                      : h(Math.max(...d.values, 0))) -
                    5
                  }
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                >
                  {valueLabel(d.values)}
                </text>
              ) : null}
              <text x={x0 + group / 2} y={base + 16} textAnchor="middle" fontSize="11">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartLegend series={series} />
    </figure>
  );
}

/** A line per series over the same labels (missing points break the line). */
export function LineChart({
  title,
  labels,
  series,
  max,
  suffix = '',
}: {
  title: string;
  labels: string[];
  series: Array<ChartSeries & { values: Array<number | null> }>;
  max?: number;
  suffix?: string;
}) {
  const W = 720;
  const H = 220;
  const left = 44;
  const base = 184;
  const top = 16;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const hi = max ?? Math.max(1, ...all);
  const step = (W - left - 16) / Math.max(1, labels.length - 1);
  const x = (i: number) => left + 8 + i * step;
  const y = (v: number) => base - ((base - top) * v) / hi;
  return (
    <figure className="ep-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((f) => (
          <g key={String(f)}>
            <line
              className="ep-chart__grid"
              x1={left}
              x2={W - 4}
              y1={y(hi * f)}
              y2={y(hi * f)}
              strokeWidth="1"
            />
            <text x={left - 6} y={y(hi * f) + 4} textAnchor="end" fontSize="11">
              {compact(hi * f)}
              {suffix}
            </text>
          </g>
        ))}
        {series.map((s) => {
          // a path that lifts the pen over days with no figure
          let d = '';
          let pen = false;
          s.values.forEach((v, i) => {
            if (v === null) pen = false;
            else {
              d += `${pen ? 'L' : 'M'}${String(x(i))} ${String(y(v))} `;
              pen = true;
            }
          });
          return (
            <g key={s.label}>
              <path className={`ep-chart-line--${s.tone}`} d={d} fill="none" strokeWidth="2.5" />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={String(i)}
                    className={`ep-chart-fill--${s.tone}`}
                    cx={x(i)}
                    cy={y(v)}
                    r="3.5"
                  >
                    <title>{`${labels[i] ?? ''} · ${s.label}: ${String(v)}${suffix}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
        {labels.map((l, i) =>
          labels.length > 16 && i % 2 ? null : (
            <text key={String(i)} x={x(i)} y={base + 16} textAnchor="middle" fontSize="11">
              {l}
            </text>
          ),
        )}
      </svg>
      <ChartLegend series={series} />
    </figure>
  );
}

/** Parts of a whole as a ring, with a figure in the middle. */
export function DonutChart({
  title,
  parts,
  centre,
  caption,
}: {
  title: string;
  parts: Array<ChartSeries & { value: number }>;
  centre: string;
  caption?: string;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const total = parts.reduce((n, p) => n + p.value, 0);
  const starts = parts.map((_, i) =>
    parts.slice(0, i).reduce((n, p) => n + (total ? (p.value / total) * C : 0), 0),
  );
  return (
    <figure className="ep-chart ep-chart--donut">
      <svg
        viewBox="0 0 120 120"
        role="img"
        aria-label={`${title}: ${parts.map((p) => `${p.label} ${String(p.value)}`).join(', ')}`}
      >
        <circle className="ep-chart__ring" cx="60" cy="60" r={R} strokeWidth="14" fill="none" />
        {total
          ? parts.map((p, i) => {
              if (!p.value) return null;
              const len = (p.value / total) * C;
              return (
                <circle
                  key={p.label}
                  className={`ep-chart-line--${p.tone}`}
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  strokeWidth="14"
                  strokeDasharray={`${String(len)} ${String(C - len)}`}
                  strokeDashoffset={String(-starts[i]!)}
                  transform="rotate(-90 60 60)"
                >
                  <title>{`${p.label}: ${String(p.value)}`}</title>
                </circle>
              );
            })
          : null}
        <text x="60" y={caption ? 58 : 66} textAnchor="middle" fontSize="19" fontWeight="700">
          {centre}
        </text>
        {caption ? (
          <text x="60" y="74" textAnchor="middle" fontSize="8">
            {caption}
          </text>
        ) : null}
      </svg>
      <ChartLegend
        series={parts.map((p) => ({ label: `${p.label} ${String(p.value)}`, tone: p.tone }))}
      />
    </figure>
  );
}

/** Rows with a bar each: how far each one is towards its own full value. */
export function ProgressRows({
  rows,
  label,
}: {
  label: string;
  rows: Array<{
    name: string;
    value: number;
    of: number;
    text: string;
    tone: ChartTone;
    href?: string;
  }>;
}) {
  return (
    <ul className="ep-chart__rows" aria-label={label}>
      {rows.map((r) => {
        const pct = r.of > 0 ? Math.max(0, Math.min(100, Math.round((r.value / r.of) * 100))) : 0;
        return (
          <li key={r.name}>
            <span className="ep-chart__rowname">
              {r.href ? (
                <a href={r.href} style={{ textDecoration: 'underline' }}>
                  {r.name}
                </a>
              ) : (
                r.name
              )}
            </span>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect className="ep-chart__track" x="0" y="0" width="100" height="8" rx="2" />
              <rect
                className={`ep-chart-fill--${r.tone}`}
                x="0"
                y="0"
                width={pct}
                height="8"
                rx="2"
              />
            </svg>
            <span className="ep-chart__rowtext">{r.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
