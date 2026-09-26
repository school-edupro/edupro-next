import type { ReactNode } from 'react';
import { Card } from './Card';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  /** Optional change indicator; tone drives colour, never decoration. */
  delta?: { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
  hint?: ReactNode;
}

export function KpiTile({ label, value, delta, hint }: KpiTileProps) {
  return (
    <Card elevated>
      <div className="ep-kpi">
        <span className="ep-kpi__value">{value}</span>
        <span className="ep-kpi__label">{label}</span>
        {delta ? <span className={`ep-badge ep-badge--${delta.tone}`}>{delta.text}</span> : null}
        {hint ? <span className="ep-field__help">{hint}</span> : null}
      </div>
    </Card>
  );
}
