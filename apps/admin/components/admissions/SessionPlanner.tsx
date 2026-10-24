'use client';
import { Badge } from '@edupro/ui';
import { useMemo, useState, useTransition } from 'react';
import { MeritPoints } from '@/components/admissions/MeritPoints';
import { VacancyShare } from '@/components/recruitment/VacancyShare';
import {
  saveSessionClasses,
  saveSessionFees,
  saveSessionRefund,
} from '@/lib/admission-setup-actions';
import type { SessionClass, SessionPlan, SessionPoints } from '@/lib/admission-setup';

type Line = Omit<SessionClass, 'className' | 'formName' | 'applications' | 'registered'> & {
  applications: number;
};

const local = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '';
const fromLocal = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);

/**
 * An admission session (docs/design/39, part 2): its classes (form, seats, window, age and date of
 * birth rules, open or closed), the fee table (registration and admission fee per class and fee
 * category), the refund deduction, and the public link with QR and poster.
 */
export function SessionPlanner({
  plan: initial,
  points,
  canEdit,
}: {
  plan: SessionPlan;
  points: SessionPoints;
  canEdit: boolean;
}) {
  const [plan, setPlan] = useState(initial);
  const [tab, setTab] = useState<'classes' | 'fees' | 'points' | 'share' | 'refund'>('classes');
  const [lines, setLines] = useState<Line[]>(() => initial.classes.map((c) => ({ ...c })));
  const [fees, setFees] = useState(() => initial.fees);
  const [refund, setRefund] = useState(initial.session.refundDeductionPct);
  const [offerDays, setOfferDays] = useState(initial.session.offerDays);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const className = useMemo(
    () => new Map(plan.allClasses.map((c) => [c.id, c.name])),
    [plan.allClasses],
  );
  // the default category (General) first, the rest in the set-up's order
  const categories = plan.categories
    .filter((c) => c.status === 'active')
    .sort((x, y) => Number(y.isDefault) - Number(x.isDefault) || x.sortOrder - y.sortOrder);
  const fee = (classId: string, categoryId: string) =>
    fees.find((f) => f.classId === classId && f.categoryId === categoryId) ?? {
      classId,
      categoryId,
      registrationFee: 0,
      admissionFee: 0,
      seats: null,
    };
  const setFee = (
    classId: string,
    categoryId: string,
    patch: Partial<{ registrationFee: number; admissionFee: number; seats: number | null }>,
  ) =>
    setFees((cur) => {
      const rest = cur.filter((f) => !(f.classId === classId && f.categoryId === categoryId));
      return [...rest, { ...fee(classId, categoryId), ...patch }];
    });
  /** Copies one class's fees and category seats to every other class of the session. */
  const copyFees = (fromClassId: string) =>
    setFees((cur) => {
      const src = categories.map((k) => fee(fromClassId, k.id));
      const others = plan.classes.filter((c) => c.classId !== fromClassId).map((c) => c.classId);
      return [
        ...cur.filter((f) => !others.includes(f.classId)),
        ...others.flatMap((classId) => src.map((f) => ({ ...f, classId }))),
      ];
    });
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const saveLines = () =>
    start(async () => {
      const r = await saveSessionClasses(
        plan.session.id,
        lines.map((l) => ({
          classId: l.classId,
          formId: l.formId,
          seats: Number(l.seats) || 0,
          opensAt: l.opensAt,
          closesAt: l.closesAt,
          ageAsOn: l.ageAsOn || null,
          dobFrom: l.dobFrom || null,
          dobTo: l.dobTo || null,
          notes: l.notes || null,
          status: l.status,
        })),
      );
      if (r.ok) {
        setPlan(r.data);
        setLines(r.data.classes.map((c) => ({ ...c })));
        setMsg({ tone: 'success', text: 'Classes saved.' });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  const saveFeesNow = () =>
    start(async () => {
      const keep = fees.filter((f) => plan.classes.some((c) => c.classId === f.classId));
      const r = await saveSessionFees(plan.session.id, keep);
      if (r.ok) {
        setPlan(r.data);
        setFees(r.data.fees);
        setMsg({ tone: 'success', text: 'Fees saved.' });
      } else setMsg({ tone: 'danger', text: r.error });
    });

  const unused = plan.allClasses.filter((c) => !lines.some((l) => l.classId === c.id));

  return (
    <div className="ep-sp">
      <div className="ep-fb__views" role="tablist" aria-label="Session">
        {(
          [
            ['classes', `Classes (${String(lines.length)})`],
            ['fees', 'Fee table'],
            ['points', 'Merit points'],
            ['refund', 'Offers and refund'],
            ['share', 'Public link, QR and poster'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="ep-fb__view"
            onClick={() => {
              setTab(k);
              setMsg(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}

      {tab === 'classes' ? (
        <section aria-label="Classes of the session">
          <p className="ep-field__help">
            Each class takes registrations with its own form. Leave the dates empty to follow the
            session ({new Date(plan.session.opensAt).toLocaleDateString('en-IN')} to{' '}
            {new Date(plan.session.closesAt).toLocaleDateString('en-IN')}). The date of birth window
            and &ldquo;age as on&rdquo; here replace the form&rsquo;s.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Classes">
            <table className="ep-table ep-table--dense ep-sp__table">
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Registration form</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Opens</th>
                  <th scope="col">Closes</th>
                  <th scope="col">Age as on</th>
                  <th scope="col">Born from</th>
                  <th scope="col">Born to</th>
                  <th scope="col">Status</th>
                  <th scope="col">Registered</th>
                  <th scope="col">
                    <span className="ep-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const name = className.get(l.classId) ?? '';
                  return (
                    <tr key={l.classId}>
                      <th scope="row">{name}</th>
                      <td>
                        <select
                          className="ep-select"
                          aria-label={`${name}: form`}
                          disabled={!canEdit}
                          value={l.formId ?? ''}
                          onChange={(e) => setLine(i, { formId: e.target.value || null })}
                        >
                          <option value="">No form yet</option>
                          {plan.forms.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="ep-input ep-sp__num"
                          aria-label={`${name}: seats`}
                          inputMode="numeric"
                          disabled={!canEdit}
                          value={l.seats}
                          onChange={(e) =>
                            setLine(i, { seats: Number(e.target.value.replace(/\D/g, '')) || 0 })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          type="datetime-local"
                          aria-label={`${name}: opens`}
                          disabled={!canEdit}
                          value={local(l.opensAt)}
                          onChange={(e) => setLine(i, { opensAt: fromLocal(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          type="datetime-local"
                          aria-label={`${name}: closes`}
                          disabled={!canEdit}
                          value={local(l.closesAt)}
                          onChange={(e) => setLine(i, { closesAt: fromLocal(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          type="date"
                          aria-label={`${name}: age as on`}
                          disabled={!canEdit}
                          value={l.ageAsOn ?? ''}
                          onChange={(e) => setLine(i, { ageAsOn: e.target.value || null })}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          type="date"
                          aria-label={`${name}: born from`}
                          disabled={!canEdit}
                          value={l.dobFrom ?? ''}
                          onChange={(e) => setLine(i, { dobFrom: e.target.value || null })}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          type="date"
                          aria-label={`${name}: born to`}
                          disabled={!canEdit}
                          value={l.dobTo ?? ''}
                          onChange={(e) => setLine(i, { dobTo: e.target.value || null })}
                        />
                      </td>
                      <td>
                        <select
                          className="ep-select"
                          aria-label={`${name}: status`}
                          disabled={!canEdit}
                          value={l.status}
                          onChange={(e) =>
                            setLine(i, { status: e.target.value as 'open' | 'closed' })
                          }
                        >
                          <option value="open">Open</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="ep-num">
                        {plan.classes.find((c) => c.classId === l.classId)?.registered ?? 0}
                      </td>
                      <td>
                        {canEdit ? (
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Remove ${name}`}
                            disabled={l.applications > 0}
                            title={
                              l.applications ? 'Has applications: close it instead' : undefined
                            }
                            onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                          >
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <div className="ep-sp__actions">
              <label className="ep-field">
                <span className="ep-field__label">Add a class</span>
                <select
                  className="ep-select"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setLines((cur) => [
                      ...cur,
                      {
                        classId: e.target.value,
                        formId: plan.forms[0]?.id ?? null,
                        seats: 40,
                        opensAt: null,
                        closesAt: null,
                        ageAsOn: null,
                        dobFrom: null,
                        dobTo: null,
                        notes: null,
                        status: 'open',
                        applications: 0,
                      },
                    ]);
                  }}
                >
                  <option value="">Choose a class…</option>
                  {unused.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={saveLines}
              >
                {pending ? 'Saving…' : 'Save classes'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'fees' ? (
        <section aria-label="Fee table">
          <p className="ep-field__help">
            The registration fee is paid with the form, the admission fee after the offer; 0 means
            no fee. A family&rsquo;s category comes from the form&rsquo;s answers and is confirmed
            at Document check. Seats of a category (EWS, for example) cap its offers; leave them
            blank to let the category use any of the class&rsquo;s seats.
          </p>
          {plan.classes.length === 0 ? (
            <p className="ep-field__help">Add the classes first.</p>
          ) : (
            <div className="ep-sp__feecards">
              {plan.classes.map((c) => {
                const capped = categories.reduce(
                  (n, k) => n + (fee(c.classId, k.id).seats ?? 0),
                  0,
                );
                return (
                  <section
                    key={c.classId}
                    className="ep-sp__feecard"
                    aria-label={`Fees of ${c.className}`}
                  >
                    <header className="ep-sp__feecard-head">
                      <h3>{c.className}</h3>
                      <span className="ep-field__help">{c.seats} seats</span>
                    </header>
                    <table className="ep-table ep-table--dense ep-sp__fees">
                      <thead>
                        <tr>
                          <th scope="col">Category</th>
                          <th scope="col">Registration fee (₹)</th>
                          <th scope="col">Admission fee (₹)</th>
                          <th scope="col">Seats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map((k) => {
                          const f = fee(c.classId, k.id);
                          return (
                            <tr key={k.id}>
                              <th scope="row">
                                {k.name}
                                {k.isDefault ? (
                                  <>
                                    {' '}
                                    <Badge tone="neutral">default</Badge>
                                  </>
                                ) : null}
                              </th>
                              <td>
                                <input
                                  className="ep-input ep-sp__num"
                                  inputMode="decimal"
                                  aria-label={`${c.className}, ${k.name}: registration fee`}
                                  disabled={!canEdit}
                                  value={f.registrationFee}
                                  onChange={(e) =>
                                    setFee(c.classId, k.id, {
                                      registrationFee:
                                        Number(e.target.value.replace(/[^\d.]/g, '')) || 0,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="ep-input ep-sp__num"
                                  inputMode="decimal"
                                  aria-label={`${c.className}, ${k.name}: admission fee`}
                                  disabled={!canEdit}
                                  value={f.admissionFee}
                                  onChange={(e) =>
                                    setFee(c.classId, k.id, {
                                      admissionFee:
                                        Number(e.target.value.replace(/[^\d.]/g, '')) || 0,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="ep-input ep-sp__num"
                                  inputMode="numeric"
                                  placeholder="Any"
                                  aria-label={`${c.className}, ${k.name}: seats (blank: any of the class's seats)`}
                                  disabled={!canEdit}
                                  value={f.seats ?? ''}
                                  onChange={(e) =>
                                    setFee(c.classId, k.id, {
                                      seats:
                                        e.target.value === ''
                                          ? null
                                          : Number(e.target.value.replace(/\D/g, '')) || 0,
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {capped > c.seats ? (
                      <p className="ep-sp__feewarn" role="alert">
                        Category seats add up to {capped}, more than the class&rsquo;s {c.seats}{' '}
                        seats.
                      </p>
                    ) : null}
                    {canEdit && plan.classes.length > 1 ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() => {
                          copyFees(c.classId);
                          setMsg({
                            tone: 'success',
                            text: `${c.className}'s fees copied to every class. Save fees to keep them.`,
                          });
                        }}
                      >
                        Copy these fees to all classes
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
          {canEdit && plan.classes.length ? (
            <div className="ep-sp__actions">
              <span className="ep-field__help">
                Categories and how a family is placed in one are set in{' '}
                <a href="/admissions/setup#as-cats">Admission set-up</a>.
              </span>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={saveFeesNow}
              >
                {pending ? 'Saving…' : 'Save fees'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'points' ? (
        <section aria-label="Merit points">
          <MeritPoints sessionId={plan.session.id} initial={points} canEdit={canEdit} />
        </section>
      ) : null}

      {tab === 'refund' ? (
        <section aria-label="Offers and refund" className="ep-sp__refund">
          <p>
            The <strong>registration fee is not refunded</strong>. When an admission is cancelled
            after the admission fee, the fee is refunded through the fee module&rsquo;s refund
            approval, less this deduction.
          </p>
          <label className="ep-field">
            <span className="ep-field__label">Deduction from the admission fee (%)</span>
            <input
              className="ep-input ep-sp__num"
              inputMode="decimal"
              disabled={!canEdit}
              value={refund}
              onChange={(e) =>
                setRefund(Math.min(100, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))
              }
            />
            <span className="ep-field__help">0 = full refund.</span>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Days an admission offer stays open</span>
            <input
              className="ep-input ep-sp__num"
              inputMode="numeric"
              disabled={!canEdit}
              value={offerDays}
              onChange={(e) =>
                setOfferDays(Math.min(90, Number(e.target.value.replace(/\D/g, '')) || 1))
              }
            />
            <span className="ep-field__help">
              The admission fee is due within these days; then the offer lapses.
            </span>
          </label>
          {canEdit ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveSessionRefund(plan.session.id, refund, offerDays);
                  setMsg(
                    r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error },
                  );
                })
              }
            >
              Save
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === 'share' ? (
        <VacancyShare
          url={plan.session.url}
          qrSrc={`/api/admission-session/${plan.session.id}/qr`}
          qrSave={`/api/admission-session/${plan.session.id}/qr?save=1`}
          qrAlt={`QR code of the registration page of ${plan.session.name}`}
          poster={{
            view: `/api/admission-session/${plan.session.id}/poster`,
            save: `/api/admission-session/${plan.session.id}/poster?save=1`,
          }}
          shareText={`Admissions open at our school for ${plan.session.academicYear}. Register online:`}
          note="Anyone can register on this page with a mobile number or email; the code to sign in goes by the channels set in Admission set-up."
        />
      ) : null}
    </div>
  );
}
