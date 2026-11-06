// Toasts and action dialogs (confirm / prompt) as small global stores. The first mounted gitnut root renders
// them (`GitnutOverlays`), so any component, hook or host-app code can call `toasts.push`, `confirmAction`
// and `promptAction` without rendering anything itself.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, GitBranch, Info, X } from "lucide-react";
import { useCx } from "./root";
import { Button, Dialog, IconButton, usePortalHost } from "./ui";
import { Checkbox, Field } from "./form";

// ---- toasts ------------------------------------------------------------------------------

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  /** git output or error text; shown collapsible below the title. */
  output?: string;
}

export interface ToastStore {
  get(): Toast[];
  subscribe(fn: () => void): () => void;
  /** Show a toast; returns its id. Success and info toasts close after `ttl`, errors stay until dismissed. */
  push(t: Omit<Toast, "id">): number;
  dismiss(id: number): void;
}

/** A toast store (the shared one is `toasts`). At most `max` toasts; older ones drop off. */
export function createToastStore({ max = 4, ttl = 6000 }: { max?: number; ttl?: number } = {}): ToastStore {
  let list: Toast[] = [];
  let seq = 0;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  const store: ToastStore = {
    get: () => list,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    push(t) {
      const id = ++seq;
      list = [...list, { ...t, id }].slice(-max);
      emit();
      if (t.kind !== "error" && ttl > 0) setTimeout(() => store.dismiss(id), ttl);
      return id;
    },
    dismiss(id) {
      if (!list.some((t) => t.id === id)) return;
      list = list.filter((t) => t.id !== id);
      emit();
    },
  };
  return store;
}

/** The shared toast store that gitnut components use. */
export const toasts = createToastStore();

/** Live list of the shared toasts plus `push` / `dismiss`. */
export function useToasts() {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.get);
  return { toasts: list, push: toasts.push, dismiss: toasts.dismiss };
}

const ICON = { success: CircleCheck, error: CircleAlert, info: Info };

/** The toast stack (bottom right). Mounted automatically by the first gitnut root; render it yourself only to place it. */
export function Toasts() {
  const { toasts: list, dismiss } = useToasts();
  return (
    <div className="gitnut-toasts" aria-live="polite">
      {list.map((t) => {
        const Icon = ICON[t.kind];
        const output = t.output?.trim();
        return (
          <div key={t.id} className={`gitnut-toast gitnut-glass gitnut-toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <div className="gitnut-toast-head">
              <Icon size={14} className="gitnut-toast-icon" />
              <strong>{t.title}</strong>
              <IconButton title="Dismiss" icon={<X size={12} />} onClick={() => dismiss(t.id)} />
            </div>
            {output && (
              <details className="gitnut-toast-details" open={t.kind === "error" || undefined}>
                <summary>git output</summary>
                <pre className="gitnut-toast-body">{output}</pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- confirm / prompt ---------------------------------------------------------------------

/** What {@link ConfirmDialog} / {@link confirmAction} shows. */
export interface ConfirmSpec {
  title: string;
  message?: ReactNode;
  /** The exact git command (or a function of the chosen option and checkbox). */
  command?: string | ((choice: string | undefined, checked: boolean) => string);
  /** Worktree the action changes, e.g. "acme-web / main". Shown because an agent may be working there. */
  worktree?: string;
  /** Red confirm button (destructive). A function of the chosen option and checkbox. */
  danger?: boolean | ((choice: string | undefined, checked: boolean) => boolean);
  confirmLabel?: string;
  /** Radio options (reset mode). */
  choices?: { value: string; label: string; hint?: string }[];
  initialChoice?: string;
  /** One checkbox (force delete, include untracked). */
  checkbox?: { label: string; initial?: boolean };
}

export interface ConfirmResult {
  choice?: string;
  checked: boolean;
}

/** What {@link PromptDialog} / {@link promptAction} shows: a name input plus the confirm options. */
export interface PromptSpec extends Omit<ConfirmSpec, "command" | "choices" | "initialChoice" | "message"> {
  label: string;
  placeholder?: string;
  initial?: string;
  /** Error text for an invalid value, or null. Empty values are invalid unless `optional`. */
  validate?: (value: string) => string | null;
  optional?: boolean;
  command?: (value: string, checked: boolean, message: string) => string;
  /** A second, optional text field (annotated tag message, stash message). */
  message?: { label: string; placeholder?: string };
}

export interface PromptResult {
  value: string;
  checked: boolean;
  message: string;
}

type Ask =
  | { kind: "confirm"; spec: ConfirmSpec; resolve: (r: ConfirmResult | null) => void }
  | { kind: "prompt"; spec: PromptSpec; resolve: (r: PromptResult | null) => void };

let asking: Ask | null = null;
const askSubs = new Set<() => void>();
const setAsk = (a: Ask | null) => {
  asking = a;
  askSubs.forEach((f) => f());
};
const ask = <R,>(a: Omit<Ask, "resolve">) =>
  new Promise<R | null>((resolve) => {
    asking?.resolve(null);
    setAsk({ ...a, resolve } as Ask);
  });

/** Ask for confirmation; resolves null when cancelled. */
export const confirmAction = (spec: ConfirmSpec) => ask<ConfirmResult>({ kind: "confirm", spec });
/** Ask for a name (branch, tag); resolves null when cancelled. */
export const promptAction = (spec: PromptSpec) => ask<PromptResult>({ kind: "prompt", spec });

/** Approximation of `git check-ref-format` for a branch / tag name (the daemon checks with git itself). */
export function checkRefName(name: string): string | null {
  if (!name) return "Enter a name";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: git ref names may not contain control characters
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return "No spaces or ~ ^ : ? * [ \\";
  if (name.startsWith("-")) return "Can't start with -";
  if (name.includes("..") || name.includes("@{") || name === "@") return "No .., @{ or a lone @";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return "No leading, trailing or double /";
  if (name.endsWith(".") || name.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"))) return "Parts can't start with . or end with .lock";
  return null;
}

function ActionDialog({ spec, prompt, onDone }: { spec: ConfirmSpec | PromptSpec; prompt: boolean; onDone: (r: (ConfirmResult & PromptResult) | null) => void }) {
  const cx = useCx();
  const id = useId();
  const p = spec as PromptSpec;
  const c = spec as ConfirmSpec;
  const [value, setValue] = useState(p.initial ?? "");
  const [message, setMessage] = useState("");
  const [checked, setChecked] = useState(spec.checkbox?.initial ?? false);
  const [choice, setChoice] = useState(prompt ? undefined : (c.initialChoice ?? c.choices?.[0]?.value));
  const [touched, setTouched] = useState(false);
  const error = prompt ? (p.optional && !value.trim() ? null : (p.validate?.(value.trim()) ?? (value.trim() ? null : "Enter a name"))) : null;
  const command = prompt ? p.command?.(value.trim(), checked, message) : typeof c.command === "function" ? c.command(choice, checked) : c.command;
  const danger = typeof spec.danger === "function" ? spec.danger(choice, checked) : spec.danger;
  const submit = () => {
    setTouched(true);
    if (!error) onDone({ value: value.trim(), message: message.trim(), checked, choice });
  };
  return (
    <Dialog title={spec.title} onClose={() => onDone(null)} className="gitnut-action-dialog">
      <form
        className="gitnut-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {spec.worktree && (
          <div className="gitnut-action-target" title="The worktree this changes. An agent may be working in it.">
            <GitBranch size={13} /> <span className="gitnut-muted">in</span> <strong>{spec.worktree}</strong>
          </div>
        )}
        {spec.message && !prompt && <div className="gitnut-action-message">{c.message}</div>}
        {prompt && (
          <Field label={p.label}>
            <input
              className={cx("input", "gitnut-input")}
              value={value}
              placeholder={p.placeholder}
              autoFocus
              spellCheck={false}
              aria-invalid={touched && !!error}
              aria-describedby={`${id}-err`}
              onChange={(e) => {
                setValue(e.target.value);
                setTouched(true);
              }}
            />
            {touched && error && (
              <small id={`${id}-err`} className="gitnut-error-text">
                {error}
              </small>
            )}
          </Field>
        )}
        {prompt && p.message && (
          <Field label={p.message.label}>
            <input className={cx("input", "gitnut-input")} value={message} placeholder={p.message.placeholder} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        )}
        {c.choices && !prompt && (
          <div className="gitnut-choices" role="radiogroup" aria-label={spec.title}>
            {c.choices.map((o) => (
              <label key={o.value} className={`gitnut-choice${choice === o.value ? " gitnut-active" : ""}`}>
                <input type="radio" name={id} checked={choice === o.value} onChange={() => setChoice(o.value)} />
                <span>
                  <strong>{o.label}</strong>
                  {o.hint && <small className="gitnut-muted">{o.hint}</small>}
                </span>
              </label>
            ))}
          </div>
        )}
        {spec.checkbox && (
          <Checkbox checked={checked} onChange={setChecked}>
            {spec.checkbox.label}
          </Checkbox>
        )}
        {command && (
          <pre className="gitnut-action-command" role="figure" aria-label="git command">
            {command}
          </pre>
        )}
        <div className="gitnut-form-actions">
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} autoFocus={!prompt} disabled={touched && !!error}>
            {spec.confirmLabel ?? "OK"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Controlled confirm dialog (danger variant for destructive ops, shows the exact git command and the worktree). */
export function ConfirmDialog(props: ConfirmSpec & { onConfirm: (r: ConfirmResult) => void; onCancel: () => void }) {
  return <ActionDialog spec={props} prompt={false} onDone={(r) => (r ? props.onConfirm({ choice: r.choice, checked: r.checked }) : props.onCancel())} />;
}

/** Controlled name prompt with validation (new branch / tag), optional checkbox and message field. */
export function PromptDialog(props: PromptSpec & { onSubmit: (r: PromptResult) => void; onCancel: () => void }) {
  return <ActionDialog spec={props} prompt onDone={(r) => (r ? props.onSubmit({ value: r.value, checked: r.checked, message: r.message }) : props.onCancel())} />;
}

// ---- host ---------------------------------------------------------------------------------

const hosts: symbol[] = [];
const hostSubs = new Set<() => void>();
const subscribeAll = (fn: () => void) => {
  hostSubs.add(fn);
  askSubs.add(fn);
  return () => {
    hostSubs.delete(fn);
    askSubs.delete(fn);
  };
};

/** Renders the shared toasts and the pending confirm / prompt. Only the first mounted one is active. */
export function GitnutOverlays() {
  const [me] = useState(() => Symbol("overlays"));
  useEffect(() => {
    hosts.push(me);
    hostSubs.forEach((f) => f());
    return () => {
      hosts.splice(hosts.indexOf(me), 1);
      hostSubs.forEach((f) => f());
    };
  }, [me]);
  const active = useSyncExternalStore(subscribeAll, () => hosts[0] === me, () => false);
  const current = useSyncExternalStore(subscribeAll, () => asking, () => null);
  const anchor = useRef<HTMLSpanElement>(null);
  const host = usePortalHost(anchor);
  const done = (r: any) => {
    const a = asking;
    setAsk(null);
    a?.resolve(r);
  };
  return (
    <span ref={anchor} hidden>
      {active && host && createPortal(<Toasts />, host)}
      {active && current && <ActionDialog key={String(current.spec.title)} spec={current.spec} prompt={current.kind === "prompt"} onDone={done} />}
    </span>
  );
}
