import { createContext, useContext, useMemo, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { GitnutOverlays } from "./overlays";
import { resolveTheme, themeToCssVars, type GitnutTheme, type GitnutThemeInput } from "./theme";

/** Named parts that accept an extra class through the `classNames` prop. */
export type GitnutSlot =
  | "root"
  | "sidebar"
  | "toolbar"
  | "button"
  | "input"
  | "row"
  | "tree"
  | "table"
  | "diff"
  | "panel"
  | "header"
  | "tabs"
  | "dialog"
  | "badge";

export type GitnutClassNames = Partial<Record<GitnutSlot, string>>;

/** Props every gitnut component accepts. */
export interface StyleProps {
  /** Theme name, full theme or partial overrides (merged over the dark theme, or `base`). Inherited from a parent gitnut component or provider. */
  theme?: GitnutThemeInput | GitnutTheme | "dark" | "light";
  /** Extra class on the component's root element. */
  className?: string;
  /** Extra classes for named parts (root, toolbar, button, row, tree, diff, panel, …). */
  classNames?: GitnutClassNames;
  style?: CSSProperties;
}

interface RootCtx {
  theme: GitnutTheme;
  classNames: GitnutClassNames;
}
const RootContext = createContext<RootCtx | null>(null);
/** Theme given to a GitnutProvider; components below it inherit it. */
export const ProviderThemeContext = createContext<{ theme?: StyleProps["theme"]; classNames?: GitnutClassNames }>({});

export function useGitnutTheme(): GitnutTheme {
  const root = useContext(RootContext);
  const provider = useContext(ProviderThemeContext);
  return root?.theme ?? resolveTheme(provider.theme);
}

/** `cx("row", "gitnut-tree-row", extra)` joins the base class with the slot class from `classNames`. */
export function useCx() {
  const names = useContext(RootContext)?.classNames;
  return (slot: GitnutSlot | null, ...base: (string | false | null | undefined)[]) =>
    [...base, slot && names?.[slot]].filter(Boolean).join(" ");
}

type RootProps = StyleProps & Omit<HTMLAttributes<HTMLDivElement>, "style" | "className"> & { children?: ReactNode; component: string };

/**
 * Root element of a gitnut component: `.gitnut-root` with the theme's CSS variables when it is the
 * outermost gitnut element or has its own theme; a plain element otherwise.
 */
export function GitnutRoot({ theme, className, classNames, style, children, component, ...rest }: RootProps) {
  const parent = useContext(RootContext);
  const provider = useContext(ProviderThemeContext);
  const own = theme !== undefined || !parent;
  const resolved = useMemo(
    () => (theme !== undefined ? resolveTheme(theme) : (parent?.theme ?? resolveTheme(provider.theme))),
    [theme, parent?.theme, provider.theme],
  );
  const ctx = useMemo(
    () => ({ theme: resolved, classNames: { ...provider.classNames, ...parent?.classNames, ...classNames } }),
    [resolved, parent?.classNames, provider.classNames, classNames],
  );
  const vars = useMemo(() => (own ? themeToCssVars(resolved) : null), [own, resolved]);
  const cls = [
    own && "gitnut-root",
    own && `gitnut-scheme-${resolved.scheme}`,
    own && resolved.density === "comfortable" && "gitnut-comfortable",
    "gitnut-c",
    `gitnut-${component}`,
    ctx.classNames.root && !parent ? ctx.classNames.root : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <RootContext.Provider value={ctx}>
      <div {...rest} className={cls} style={vars ? { ...vars, ...style } : style}>
        {children}
        {!parent && <GitnutOverlays />}
      </div>
    </RootContext.Provider>
  );
}
