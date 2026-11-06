import { expect, test } from "bun:test";
import { ACCENTS, accentTheme, darkTheme, lightTheme, resolveTheme, themeToCssVars } from "../src/theme";

test("R-SDK-2: theme tokens map to --gitnut-* CSS variables", () => {
  const v = themeToCssVars(darkTheme);
  expect(v["--gitnut-background"]).toBe("#07060b");
  expect(v["--gitnut-primary"]).toBe("#8b5cf6");
  expect(v["--gitnut-gradient"]).toContain("linear-gradient");
  expect(v["--gitnut-status-added"]).toBe(darkTheme.colors.status.added);
  expect(v["--gitnut-diff-modified"]).toBe(darkTheme.colors.diff.modified);
  expect(v["--gitnut-radius-md"]).toBe("0.5rem");
  expect(v["--gitnut-control-height-sm"]).toBe("22px");
  expect(v["--gitnut-font-mono"]).toContain("monospace");
  expect(v["--gitnut-glass-blur"]).toBe("20px");
  expect(v["--gitnut-row-height"]).toBe("22px");
});

test("R-SDK-2: partial themes merge over a base; density changes the row height", () => {
  const t = resolveTheme({ base: "light", colors: { primary: "#0f766e" }, radius: { md: "12px" }, density: "comfortable" });
  expect(t.scheme).toBe("light");
  expect(t.colors.primary).toBe("#0f766e");
  expect(t.colors.background).toBe(lightTheme.colors.background);
  expect(t.radius).toEqual({ ...lightTheme.radius, md: "12px" });
  expect(themeToCssVars(t)["--gitnut-row-height"]).toBe("26px");
  expect(resolveTheme("light")).toBe(lightTheme);
  expect(resolveTheme(undefined)).toBe(darkTheme);
});

test("R-LIST-2: accent presets and custom colours make primary, gradient and backdrop", () => {
  const ocean = resolveTheme(accentTheme("ocean", "light"));
  expect(ocean.scheme).toBe("light");
  expect(ocean.colors.primary).toBe(ACCENTS.ocean.primary);
  expect(ocean.colors.gradient).toContain(ACCENTS.ocean.stops[0]);
  expect(ocean.colors.backdrop).toContain(ACCENTS.ocean.stops[2]);
  const custom = resolveTheme(accentTheme("#ff8800"));
  expect(custom.colors.primary).toBe("#ff8800");
  expect(custom.colors.gradient).toContain("#ff8800");
  expect(custom.colors.status).toEqual(darkTheme.colors.status);
});
