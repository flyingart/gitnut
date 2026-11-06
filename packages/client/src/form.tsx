import type { ReactNode } from "react";

/**
 * Form building blocks shared by every settings screen and dialog, so spacing and dividers are the
 * same everywhere. Sections stack with a divider between them, also across separate panels.
 */
export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="gitnut-section">
      <div className="gitnut-section-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Label above a control, with an optional muted hint below. `as="div"` when the control is not one input. */
export function Field({ label, hint, children, as = "label" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; as?: "label" | "div" }) {
  const Tag = as;
  return (
    <Tag className="gitnut-field">
      <span>{label}</span>
      {children}
      {hint && <small className="gitnut-muted">{hint}</small>}
    </Tag>
  );
}

/** Controls side by side (wraps on narrow screens). */
export const FieldRow = ({ children, center }: { children: ReactNode; center?: boolean }) => (
  <div className={center ? "gitnut-field-row gitnut-align-center" : "gitnut-field-row"}>{children}</div>
);

/** Checkbox with its label. */
export function Checkbox({ checked, onChange, children, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className="gitnut-checkbox" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
