'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { bulkLeads } from '@/lib/admission-enquiry-actions';

/** Hot / warm / cold, set by the counsellor (docs/design/45). */
export function LeadScore({ id, score }: { id: string; score: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="ep-field ep-lead-score">
      <span className="ep-field__label">Score</span>
      <select
        className="ep-select ep-select--sm"
        data-native
        value={score ?? ''}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await bulkLeads({ ids: [id], score: e.target.value || 'none' });
            router.refresh();
          })
        }
      >
        <option value="">Not scored</option>
        <option value="hot">Hot</option>
        <option value="warm">Warm</option>
        <option value="cold">Cold</option>
      </select>
    </label>
  );
}
