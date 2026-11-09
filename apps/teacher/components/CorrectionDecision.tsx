/** Approve or not an attendance correction (docs/design/85, phase C): the staff app's decision form. */
export function CorrectionDecision({
  action,
  back,
  fid,
}: {
  action: (fd: FormData) => Promise<void>;
  back: string;
  fid: string;
}) {
  return (
    <form action={action} className="ep-form-section__body">
      <input type="hidden" name="back" value={back} />
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">Decision</legend>
        <label className="ep-check" htmlFor={`${fid}-y`}>
          <input
            id={`${fid}-y`}
            type="radio"
            name="outcome"
            value="approved"
            defaultChecked
            className="ep-check__input"
          />
          <span className="ep-check__box" />
          Approve: set the day as asked
        </label>
        <label className="ep-check" htmlFor={`${fid}-n`}>
          <input
            id={`${fid}-n`}
            type="radio"
            name="outcome"
            value="rejected"
            className="ep-check__input"
          />
          <span className="ep-check__box" />
          Not approve
        </label>
      </fieldset>
      <label className="ep-field" htmlFor={`${fid}-note`}>
        <span className="ep-field__label">Remark (needed for “Not approve”)</span>
        <textarea id={`${fid}-note`} name="note" rows={2} maxLength={500} className="ep-input" />
      </label>
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        Send the decision
      </button>
    </form>
  );
}
