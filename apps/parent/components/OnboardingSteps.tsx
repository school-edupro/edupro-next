'use client';

import { useEffect, useRef, useState } from 'react';

export interface OnboardingLabels {
  steps: [string, string, string];
  stepOf: string;
  welcomeTitle: string;
  welcomeLead: string;
  kidsTitle: string;
  admissionNo: string;
  whatNext: string;
  points: string[];
  start: string;
  noticeTitle: string;
  noticeLead: string;
  version: string;
  next: string;
  back: string;
  choicesTitle: string;
  choicesLead: string;
  alwaysOn: string;
  alwaysTitle: string;
  alwaysText: string;
  allowAll: string;
  clearAll: string;
  on: string;
  off: string;
  accept: string;
  finish: string;
  changeLater: string;
  chosen: string;
}
export interface OnboardingPurpose {
  code: string;
  name: string;
  description: string;
  isRequired: boolean;
  /** What was recorded before (a new version of the notice shows the earlier choice). */
  granted: boolean;
}
export interface OnboardingKid {
  id: string;
  name: string;
  section: string | null;
  admissionNo: string | null;
  hasPhoto: boolean;
}

/**
 * First sign-in in three short steps: welcome (who you are signing in for), the privacy notice, and the
 * consent choices. Optional choices start off; the person switches on what they agree to and ticks
 * that the notice has been read. Everything is sent together on Finish.
 */
export function OnboardingSteps({
  labels: l,
  version,
  noticeTitle,
  paragraphs,
  purposes,
  kids,
  action,
}: {
  labels: OnboardingLabels;
  version: number;
  noticeTitle: string;
  paragraphs: string[];
  purposes: OnboardingPurpose[];
  kids: OnboardingKid[];
  action: (fd: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const optional = purposes.filter((p) => !p.isRequired);
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(optional.map((p) => [p.code, p.granted])),
  );
  const [accepted, setAccepted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // a new step is announced and read from its heading
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);
  const allOn = optional.length > 0 && optional.every((p) => on[p.code]);
  const count = optional.filter((p) => on[p.code]).length;
  const go = (n: number) => setStep(Math.max(0, Math.min(2, n)));
  return (
    <form action={action} className="fp-ob__wrap">
      <div hidden>
        <input type="hidden" name="version" value={version} />
        {optional.map((p) => (
          <span key={p.code}>
            <input type="hidden" name="purpose" value={p.code} />
            {on[p.code] ? <input type="hidden" name={`consent.${p.code}`} value="granted" /> : null}
          </span>
        ))}
      </div>
      <ol className="fp-ob__progress" aria-label={l.stepOf.replace('{n}', String(step + 1))}>
        {l.steps.map((s, i) => (
          <li
            key={s}
            data-state={i < step ? 'done' : i === step ? 'now' : 'next'}
            aria-current={i === step ? 'step' : undefined}
          >
            {String(i + 1)}. {s}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="fp-ob__card" aria-labelledby="ob-h">
          <h1 id="ob-h" ref={heading} tabIndex={-1}>
            {l.welcomeTitle}
          </h1>
          <p className="fp-ob__lead">{l.welcomeLead}</p>
          {kids.length > 0 ? (
            <div>
              <p className="ep-kicker">{l.kidsTitle}</p>
              <div className="fp-ob__kids">
                {kids.map((k) => (
                  <div key={k.id} className="fp-ob__kid">
                    {k.hasPhoto ? (
                      <img className="fp-ob__kid-photo" src={`/api/photo/${k.id}/student`} alt="" />
                    ) : (
                      <span className="fp-ob__kid-photo" aria-hidden="true">
                        {k.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <strong>{k.name}</strong>
                      <span>
                        {[k.section, k.admissionNo ? `${l.admissionNo} ${k.admissionNo}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <p className="ep-kicker">{l.whatNext}</p>
            <ul className="fp-ob__points">
              {l.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="fp-ob__nav">
            <span />
            <button type="button" className="ep-btn ep-btn--primary" onClick={() => go(1)}>
              {l.start}
            </button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="fp-ob__card" aria-labelledby="ob-h">
          <div className="fp-ob__between">
            <h1 id="ob-h" ref={heading} tabIndex={-1}>
              {noticeTitle || l.noticeTitle}
            </h1>
            <span className="ep-badge ep-badge--neutral">
              {l.version} {version}
            </span>
          </div>
          <p className="fp-ob__lead">{l.noticeLead}</p>
          {/* the notice scrolls inside its box on a small screen; the keyboard can reach it */}
          <div className="fp-ob__notice" tabIndex={0} role="region" aria-label={l.noticeTitle}>
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="fp-ob__nav">
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => go(0)}>
              {l.back}
            </button>
            <button type="button" className="ep-btn ep-btn--primary" onClick={() => go(2)}>
              {l.next}
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="fp-ob__card" aria-labelledby="ob-h">
          <h1 id="ob-h" ref={heading} tabIndex={-1}>
            {l.choicesTitle}
          </h1>
          <p className="fp-ob__lead">{l.choicesLead}</p>
          <div className="fp-ob__rows">
            <div className="fp-ob__row">
              <div>
                <strong>{l.alwaysTitle}</strong>
                <p>{l.alwaysText}</p>
              </div>
              <span className="fp-ob__always">{l.alwaysOn}</span>
            </div>
            {purposes
              .filter((p) => p.isRequired)
              .map((p) => (
                <div key={p.code} className="fp-ob__row">
                  <div>
                    <strong>{p.name}</strong>
                    <p>{p.description}</p>
                  </div>
                  <span className="fp-ob__always">{l.alwaysOn}</span>
                </div>
              ))}
          </div>
          {optional.length > 0 ? (
            <>
              <div className="fp-ob__between">
                <span className="ep-field__help" role="status">
                  {l.chosen.replace('{n}', String(count)).replace('{m}', String(optional.length))}
                </span>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() => setOn(Object.fromEntries(optional.map((p) => [p.code, !allOn])))}
                >
                  {allOn ? l.clearAll : l.allowAll}
                </button>
              </div>
              <div className="fp-ob__rows">
                {optional.map((p) => (
                  <div key={p.code} className="fp-ob__row" data-on={on[p.code] ? 'true' : 'false'}>
                    <div>
                      <strong id={`ob-${p.code}`}>{p.name}</strong>
                      <p id={`ob-${p.code}-d`}>{p.description}</p>
                    </div>
                    <span className="ep-switch">
                      <button
                        type="button"
                        role="switch"
                        className="ep-switch__track"
                        aria-checked={Boolean(on[p.code])}
                        aria-labelledby={`ob-${p.code}`}
                        aria-describedby={`ob-${p.code}-d`}
                        onClick={() => setOn((v) => ({ ...v, [p.code]: !v[p.code] }))}
                      >
                        <span className="ep-switch__thumb" aria-hidden="true" />
                      </button>
                      <span aria-hidden="true">{on[p.code] ? l.on : l.off}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <label className="fp-ob__accept" htmlFor="ob-accept">
            <input
              id="ob-accept"
              name="accept"
              type="checkbox"
              value="yes"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>{l.accept}</span>
          </label>
          <p className="ep-field__help">{l.changeLater}</p>
          <div className="fp-ob__nav">
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => go(1)}>
              {l.back}
            </button>
            <button type="submit" className="ep-btn ep-btn--primary" disabled={!accepted}>
              {l.finish}
            </button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
