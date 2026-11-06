import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import { useCx } from "./root";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
  active?: boolean;
};

export function Button({ variant = "default", size = "md", icon, busy, active, className, children, ...rest }: BtnProps) {
  const cx = useCx();
  return (
    <button
      type="button"
      {...rest}
      className={cx("button", "gitnut-btn", `gitnut-btn-${variant}`, `gitnut-btn-${size}`, !children && "gitnut-btn-icon", active && "gitnut-active", className)}
      aria-pressed={active}
      disabled={rest.disabled || busy}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** Square icon button with a tooltip. */
export const IconButton = ({ title, ...rest }: BtnProps & { title: string }) => (
  <Button variant="ghost" size="sm" title={title} aria-label={title} {...rest} />
);

export const Spinner = ({ size = 14 }: { size?: number }) => <LoaderCircle size={size} className="gitnut-spin" aria-hidden />;

/** Segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label?: ReactNode; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="gitnut-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          aria-label={o.title}
          className={value === o.value ? "gitnut-active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="gitnut-empty">
      {icon}
      <div className="gitnut-empty-title">{title}</div>
      {children && <div className="gitnut-empty-text">{children}</div>}
    </div>
  );
}

/**
 * A body-level element for portals that carries the theme of the `.gitnut-root` around `anchor`
 * (render `<span ref={anchor} hidden />` where the portal is used).
 */
export function usePortalHost(anchor: RefObject<HTMLElement | null>) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = anchor.current?.closest(".gitnut-root") as HTMLElement | null;
    const el = document.createElement("div");
    const sync = () => {
      if (!root) return;
      el.className = root.className.split(" ").filter((c) => c === "gitnut-root" || c.startsWith("gitnut-scheme") || c === "gitnut-comfortable").join(" ") + " gitnut-portal";
      el.style.cssText = root.style.cssText;
    };
    sync();
    // follow theme changes of the root (appearance settings) while the portal is open
    const mo = root ? new MutationObserver(sync) : null;
    if (root) mo!.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    document.body.appendChild(el);
    setHost(el);
    return () => {
      mo?.disconnect();
      el.remove();
    };
  }, [anchor]);
  return host;
}

/** Modal dialog in a portal, inside a themed `.gitnut-root` copy of the caller's root. */
export function Dialog({ title, onClose, children, wide, className }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const cx = useCx();
  const anchor = useRef<HTMLSpanElement>(null);
  const host = usePortalHost(anchor);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <span ref={anchor} hidden>
      {host &&
        createPortal(
          <div className="gitnut-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className={cx("dialog", "gitnut-dialog", "gitnut-glass", wide && "gitnut-dialog-wide", className)} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
              <div className="gitnut-dialog-head">
                <div className="gitnut-dialog-title">{title}</div>
                <IconButton title="Close" icon={<X size={14} />} onClick={onClose} />
              </div>
              <div className="gitnut-dialog-body">{children}</div>
            </div>
          </div>,
          host,
        )}
    </span>
  );
}

/** One entry of a {@link ContextMenu}; `"separator"` draws a line. */
export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      disabled?: boolean;
      /** Red text for destructive actions. */
      danger?: boolean;
      /** Muted text on the right (shortcut, reason why it is disabled). */
      hint?: string;
    }
  | "separator";

/** Props of {@link ContextMenu}. */
export interface ContextMenuProps {
  /** Viewport position (clientX / clientY of the click). */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** Accessible name. */
  label?: string;
}

/**
 * Right-click menu at a viewport position: arrow keys / Home / End move, Enter runs, Escape, Tab or a click
 * outside close it, and focus goes back where it was.
 */
export function ContextMenu({ x, y, items, onClose, label = "Actions" }: ContextMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const host = usePortalHost(anchor);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - width - 4));
    const top = y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y;
    setPos({ left, top, ready: true });
  }, [x, y, host]);
  // focus once visible (a visibility:hidden element can't take focus)
  useEffect(() => {
    if (pos.ready) (ref.current?.querySelector("[role=menuitem]:not([disabled])") as HTMLElement | null)?.focus();
  }, [pos.ready]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close.current();
    const onBlur = () => close.current();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
      // back to the row the menu came from, unless the chosen item focused something else (a dialog)
      const now = document.activeElement;
      if (before && document.contains(before) && (!now || now === document.body)) before.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") close.current();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <span ref={anchor} hidden>
      {host &&
        createPortal(
          <div
            ref={ref}
            role="menu"
            aria-label={label}
            className="gitnut-menu gitnut-context-menu gitnut-glass"
            style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((it, i) =>
              it === "separator" ? (
                i > 0 && i < items.length - 1 && items[i - 1] !== "separator" ? <div key={i} role="separator" className="gitnut-menu-sep" /> : null
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={it.disabled}
                  className={`gitnut-menu-item${it.danger ? " gitnut-menu-danger" : ""}`}
                  onClick={() => {
                    close.current();
                    it.onSelect?.();
                  }}
                >
                  <span className="gitnut-menu-icon">{it.icon}</span>
                  <span className="gitnut-menu-text">{it.label}</span>
                  {it.hint && <span className="gitnut-menu-hint">{it.hint}</span>}
                </button>
              ),
            )}
          </div>,
          host,
        )}
    </span>
  );
}

/** State for one context menu: `open(event, items)` shows it at the pointer; render `menu`. */
export function useContextMenu() {
  const [m, setM] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setM(null), []);
  const open = useCallback((at: { clientX: number; clientY: number }, items: MenuItem[]) => setM({ x: at.clientX, y: at.clientY, items }), []);
  return { open, close, menu: m ? <ContextMenu x={m.x} y={m.y} items={m.items} onClose={close} /> : null };
}

/** Viewport point for a keyboard-opened menu (ContextMenu key / Shift+F10): bottom-left of the element. */
export const menuPointOf = (el: Element | null | undefined) => {
  const r = el?.getBoundingClientRect();
  return { clientX: (r?.left ?? 0) + 24, clientY: r?.bottom ?? 0 };
};

/** True for the keys that open a context menu from the keyboard. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/** Fixed-height row virtualization for a scroll container. */
export function useVirtualRows(ref: RefObject<HTMLElement | null>, rowCount: number, rowHeight: number, overscan = 8) {
  const [view, setView] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const last = Math.min(rowCount, Math.ceil((view.top + view.height) / rowHeight) + overscan);
  const scrollToRow = (row: number, center = false) => {
    const el = ref.current;
    if (!el || row < 0) return;
    const y = row * rowHeight;
    if (center) el.scrollTop = y - el.clientHeight / 2 + rowHeight / 2;
    else if (y < el.scrollTop) el.scrollTop = y;
    else if (y + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = y + rowHeight - el.clientHeight;
  };
  return { first, last, top: view.top, height: view.height, scrollToRow };
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Format unix seconds like IntelliJ's log: "Today 14:02", "Yesterday 09:12", else a short date and time. */
/** Bytes as B / KB / MB. */
export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function formatDate(sec: number, now = Date.now()): string {
  const t = sec * 1000;
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const time = TIME.format(t);
  if (t >= day.getTime()) return `Today ${time}`;
  if (t >= day.getTime() - 86400_000) return `Yesterday ${time}`;
  return `${DAY.format(t)}, ${time}`;
}

export function formatFullDate(sec: number): string {
  return FULL.format(sec * 1000);
}

/** Copy text; returns true when it worked. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Button with a dropdown panel; closes on outside click and Escape. */
export function Popover({
  label,
  title,
  icon,
  active,
  align = "left",
  children,
  className,
}: {
  label?: ReactNode;
  title: string;
  icon?: ReactNode;
  active?: boolean;
  align?: "left" | "right";
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`gitnut-popover-wrap ${className ?? ""}`} ref={ref}>
      <Button variant="ghost" size="sm" icon={icon} title={title} aria-label={label ? undefined : title} aria-expanded={open} active={active || open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && <div className={`gitnut-popover gitnut-glass gitnut-popover-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
