import type { ReactNode } from 'react';

export interface FormSectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** Groups related fields under a heading; the first section of a form carries the primary intent. */
export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <fieldset className="ep-form-section">
      <legend className="ep-form-section__title">{title}</legend>
      {description ? <p className="ep-form-section__description">{description}</p> : null}
      <div className="ep-form-section__body">{children}</div>
    </fieldset>
  );
}

export interface FormRowProps {
  /** Fields per row on wide screens; collapses to one column on phones. */
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
}

export function FormRow({ columns = 2, children }: FormRowProps) {
  return (
    <div className="ep-form-row" data-columns={columns}>
      {children}
    </div>
  );
}

export interface FormActionsProps {
  children: ReactNode;
  align?: 'start' | 'end';
  /** Sticks to the bottom of long forms so the primary action stays reachable. */
  sticky?: boolean;
}

export function FormActions({ children, align = 'start', sticky = false }: FormActionsProps) {
  return (
    <div className="ep-form-actions" data-align={align} data-sticky={sticky ? 'true' : undefined}>
      {children}
    </div>
  );
}
