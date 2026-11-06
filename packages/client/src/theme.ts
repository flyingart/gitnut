import type { ChangeStatus } from "@gitnut/commons";

/** Visual tokens. Every token maps to a `--gitnut-*` CSS variable on the component root. */
export interface GitnutTheme {
  /** "dark" also picks the IntelliJ dark graph palette. */
  scheme: "dark" | "light";
  colors: {
    background: string;
    surface: string;
    raised: string;
    hover: string;
    selection: string;
    /** Selection when the list does not have focus. */
    selectionInactive: string;
    border: string;
    text: string;
    mutedText: string;
    primary: string;
    primaryText: string;
    /** Accent gradient: primary buttons, logo, highlights. */
    gradient: string;
    /** Page background behind the glass panels of the full app (colour or gradients). */
    backdrop: string;
    danger: string;
    success: string;
    warning: string;
    focus: string;
    status: Record<ChangeStatus, string>;
    diff: { inserted: string; deleted: string; modified: string };
    refs: { head: string; local: string; remote: string; tag: string };
    syntax: {
      keyword: string;
      string: string;
      number: string;
      comment: string;
      function: string;
      type: string;
      property: string;
      variable: string;
      operator: string;
      meta: string;
    };
  };
  /** Override graph lane colours: a list of CSS colours indexed by `colorId` (mod length). Default: IntelliJ palette. */
  graphPalette?: string[];
  radius: { sm: string; md: string; lg: string };
  controlHeight: { sm: string; md: string; lg: string };
  space: { xs: string; sm: string; md: string; lg: string; xl: string };
  font: { sans: string; mono: string };
  fontSize: { xs: string; sm: string; md: string; lg: string };
  /** Row height of lists, trees and the commit table in px. */
  rowHeight: number;
  glass: { blur: string; opacity: string; saturation: string };
  density: "compact" | "comfortable";
}

/** Partial theme: anything not given comes from the base theme. */
export type GitnutThemeInput = DeepPartial<GitnutTheme> & { base?: "dark" | "light" };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

const shared = {
  radius: { sm: "0.3125rem", md: "0.5rem", lg: "0.75rem" },
  controlHeight: { sm: "22px", md: "26px", lg: "32px" },
  space: { xs: "2px", sm: "4px", md: "8px", lg: "12px", xl: "16px" },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  },
  fontSize: { xs: "11px", sm: "12px", md: "13px", lg: "15px" },
  rowHeight: 22,
  glass: { blur: "20px", opacity: "86%", saturation: "150%" },
  density: "compact" as const,
};

/** Accent presets for {@link accentTheme}. Every gradient runs light-to-deep at 135deg. */
export const ACCENTS = {
  coconut: { label: "Coconut", primary: "#8b5cf6", stops: ["#ec4899", "#a855f7", "#6366f1"] },
  t3: { label: "T3 blue", primary: "oklch(0.571 0.21 264)", stops: ["#6366f1", "#4f63e8", "#3b5bdb"] },
  ocean: { label: "Ocean", primary: "#3b82f6", stops: ["#22d3ee", "#3b82f6", "#6366f1"] },
  emerald: { label: "Emerald", primary: "#10b981", stops: ["#34d399", "#10b981", "#0891b2"] },
  sunset: { label: "Sunset", primary: "#f43f5e", stops: ["#fb923c", "#f43f5e", "#c026d3"] },
  mono: { label: "Mono", primary: "#737373", stops: ["#a3a3a3", "#737373", "#525252"] },
} as const;
export type AccentName = keyof typeof ACCENTS;

const gradientOf = (stops: readonly string[]) => `linear-gradient(135deg, ${stops[0]}, ${stops[1]} 50%, ${stops[2]})`;
const backdropOf = (stops: readonly string[], scheme: "dark" | "light") => {
  const a = scheme === "dark" ? 14 : 10;
  const base = scheme === "dark" ? "#07060b" : "#f7f6fb";
  return `radial-gradient(90rem 50rem at 0% 0%, color-mix(in srgb, ${stops[0]} ${a}%, transparent), transparent 60%), radial-gradient(80rem 50rem at 100% 100%, color-mix(in srgb, ${stops[2]} ${a}%, transparent), transparent 60%), ${base}`;
};

/**
 * Theme overrides for an accent: a preset name or any CSS colour (gradient derived from it).
 * Use as `theme={accentTheme("ocean")}` or merged into your own theme.
 */
export function accentTheme(accent: AccentName | (string & {}) = "coconut", scheme: "dark" | "light" = "dark"): GitnutThemeInput {
  const preset = (ACCENTS as Record<string, { primary: string; stops: readonly string[] }>)[accent];
  const primary = preset?.primary ?? accent;
  const stops = preset?.stops ?? [`color-mix(in oklch, ${accent} 70%, white)`, accent, `color-mix(in oklch, ${accent} 70%, black)`];
  return { base: scheme, colors: { primary, gradient: gradientOf(stops), backdrop: backdropOf(stops, scheme), focus: scheme === "dark" ? `color-mix(in srgb, ${primary} 75%, white)` : primary } };
}

/** T3 Code look: near black, hairline white borders, coconut pink-violet-blue accent. IntelliJ "Dark" status and syntax colours. */
export const darkTheme: GitnutTheme = {
  ...shared,
  scheme: "dark",
  colors: {
    background: "#07060b",
    surface: "#0c0b12",
    raised: "#15141d",
    hover: "rgb(255 255 255 / 4.5%)",
    selection: "color-mix(in srgb, var(--gitnut-primary) 30%, transparent)",
    selectionInactive: "color-mix(in srgb, var(--gitnut-primary) 15%, rgb(255 255 255 / 6%))",
    border: "rgb(255 255 255 / 8%)",
    text: "#f5f5f5",
    mutedText: "#a3a3a3",
    primary: ACCENTS.coconut.primary,
    primaryText: "#ffffff",
    gradient: gradientOf(ACCENTS.coconut.stops),
    backdrop: backdropOf(ACCENTS.coconut.stops, "dark"),
    danger: "#f26d6d",
    success: "#5fb865",
    warning: "#e2b048",
    focus: "color-mix(in srgb, var(--gitnut-primary) 80%, white)",
    status: {
      added: "#73bd79",
      modified: "#6c9ff2",
      deleted: "#8a8f98",
      renamed: "#5cb8c2",
      copied: "#5cb8c2",
      typechange: "#c49ae8",
      conflicted: "#f26d6d",
      untracked: "#d1806b",
    },
    diff: { inserted: "#54b05f", deleted: "#8c8f99", modified: "#4a86e8" },
    refs: { head: "#e2b048", local: "#73bd79", remote: "#a87cd6", tag: "#8a8f98" },
    syntax: {
      keyword: "#cf8e6d",
      string: "#6aab73",
      number: "#2aacb8",
      comment: "#7a7e85",
      function: "#56a8f5",
      type: "#bcbec4",
      property: "#c77dbb",
      variable: "#bcbec4",
      operator: "#bcbec4",
      meta: "#b3ae60",
    },
  },
};

export const lightTheme: GitnutTheme = {
  ...shared,
  scheme: "light",
  glass: { blur: "20px", opacity: "90%", saturation: "150%" },
  colors: {
    background: "#ffffff",
    surface: "#fafafa",
    raised: "#ffffff",
    hover: "rgb(0 0 0 / 4%)",
    selection: "color-mix(in srgb, var(--gitnut-primary) 18%, transparent)",
    selectionInactive: "color-mix(in srgb, var(--gitnut-primary) 9%, rgb(0 0 0 / 5%))",
    border: "rgb(0 0 0 / 9%)",
    text: "#171717",
    mutedText: "#646464",
    primary: "#7c3aed",
    primaryText: "#ffffff",
    gradient: gradientOf(ACCENTS.coconut.stops),
    backdrop: backdropOf(ACCENTS.coconut.stops, "light"),
    danger: "#d43c3c",
    success: "#3c8a43",
    warning: "#b07d10",
    focus: "#7c3aed",
    status: {
      added: "#3c8a43",
      modified: "#3574f0",
      deleted: "#7a7e85",
      renamed: "#1a8a96",
      copied: "#1a8a96",
      typechange: "#8a4fbd",
      conflicted: "#d43c3c",
      untracked: "#a35532",
    },
    diff: { inserted: "#3fa34d", deleted: "#9a9ca3", modified: "#3574f0" },
    refs: { head: "#b07d10", local: "#3c8a43", remote: "#8a4fbd", tag: "#7a7e85" },
    syntax: {
      keyword: "#0033b3",
      string: "#067d17",
      number: "#1750eb",
      comment: "#8c8c8c",
      function: "#00627a",
      type: "#000000",
      property: "#871094",
      variable: "#000000",
      operator: "#000000",
      meta: "#9e880d",
    },
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function merge<T>(base: T, over: unknown): T {
  if (!isObj(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out as T;
}

/** Resolve a theme prop: a name, a full theme or a partial one over `base` (default dark). */
export function resolveTheme(input?: GitnutThemeInput | GitnutTheme | "dark" | "light" | null): GitnutTheme {
  if (!input) return darkTheme;
  if (input === "dark" || input === "light") return input === "dark" ? darkTheme : lightTheme;
  const base = (input as GitnutThemeInput).base ?? (input as GitnutThemeInput).scheme ?? "dark";
  return merge(base === "light" ? lightTheme : darkTheme, input);
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** Flatten a theme into `--gitnut-*` CSS variables (for the `style` of `.gitnut-root`). */
export function themeToCssVars(theme: GitnutTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "graphPalette" || k === "scheme") continue;
      const name = `${prefix}-${kebab(k)}`;
      if (isObj(v)) walk(v, name);
      else vars[name] = typeof v === "number" ? `${v}px` : String(v);
    }
  };
  const { colors, ...rest } = theme;
  walk(colors as unknown as Record<string, unknown>, "--gitnut");
  walk(rest as unknown as Record<string, unknown>, "--gitnut");
  vars["--gitnut-row-height"] = `${rowHeightOf(theme)}px`;
  return vars;
}

/** Effective row height: the token plus 4px in comfortable density. */
export const rowHeightOf = (theme: GitnutTheme) => theme.rowHeight + (theme.density === "comfortable" ? 4 : 0);
