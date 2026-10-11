/**
 * Put first inside a form that has several decision buttons (Approve / Reject). Pressing Enter in a
 * text box "clicks" the first submit button of the form; with this disabled button first, Enter does
 * nothing, so a decision is only ever made by pressing its own button.
 */
export function NoEnterSubmit() {
  return <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />;
}
