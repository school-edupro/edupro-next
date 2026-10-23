import type { EnquiryDetail, EnquiryMeta } from '@/lib/admission-enquiry';

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
  gap: 'var(--sp-3)',
} as const;

/** The enquiry's fields (new and edit): the family, the child, the class sought, where it came from, who follows it. */
export function EnquiryFields({ meta, value }: { meta: EnquiryMeta; value?: EnquiryDetail }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div style={grid}>
        <label className="ep-field">
          <span className="ep-field__label">Parent&apos;s name</span>
          <input
            className="ep-input"
            name="parentName"
            required
            minLength={2}
            maxLength={120}
            defaultValue={value?.parentName ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Mobile</span>
          <input
            className="ep-input"
            name="mobile"
            inputMode="numeric"
            pattern="[6-9][0-9]{9}"
            maxLength={10}
            defaultValue={value?.mobile ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Email</span>
          <input
            className="ep-input"
            name="email"
            type="email"
            maxLength={200}
            defaultValue={value?.email ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Locality</span>
          <input
            className="ep-input"
            name="locality"
            maxLength={120}
            defaultValue={value?.locality ?? ''}
          />
        </label>
      </div>
      <div style={grid}>
        <label className="ep-field">
          <span className="ep-field__label">Child&apos;s name</span>
          <input
            className="ep-input"
            name="childName"
            maxLength={120}
            defaultValue={value?.childName ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Date of birth</span>
          <input
            className="ep-input"
            name="childDob"
            type="date"
            defaultValue={value?.childDob ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class sought</span>
          <select className="ep-select" name="classId" defaultValue={value?.classId ?? ''}>
            <option value="">Not decided</option>
            {meta.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Session</span>
          <select
            className="ep-select"
            name="cycleId"
            defaultValue={value?.cycleId ?? meta.cycles.find((c) => c.status === 'open')?.id ?? ''}
          >
            <option value="">Not decided</option>
            {meta.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Previous school</span>
          <input
            className="ep-input"
            name="previousSchool"
            maxLength={160}
            defaultValue={value?.previousSchool ?? ''}
          />
        </label>
      </div>
      <div style={grid}>
        <label className="ep-field">
          <span className="ep-field__label">Came from</span>
          <select
            className="ep-select"
            name="sourceId"
            defaultValue={value?.sourceId ?? meta.sources[0]?.id ?? ''}
          >
            <option value="">Not known</option>
            {meta.sources
              .filter((s) => s.status === 'active' || s.id === value?.sourceId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Campaign</span>
          <input
            className="ep-input"
            name="campaign"
            maxLength={80}
            placeholder="e.g. Open house Nov"
            defaultValue={value?.campaign ?? ''}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Counsellor</span>
          <select
            className="ep-select"
            name="counsellorUserId"
            defaultValue={value?.counsellorUserId ?? ''}
          >
            <option value="">Me</option>
            {meta.counsellors.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Next follow-up</span>
          <input
            className="ep-input"
            name="nextFollowUpOn"
            type="date"
            defaultValue={value?.nextFollowUpOn ?? ''}
          />
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Notes</span>
        <textarea
          className="ep-input"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={value?.notes ?? ''}
        />
      </label>
      <p className="ep-field__help" style={{ margin: 0 }}>
        Give the mobile or the email. The family can be invited to register by a link that fills the
        form with these details.
      </p>
    </div>
  );
}
