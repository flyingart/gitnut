// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/GraphColorGetterByHead.kt,
// platform/vcs-log/impl/src/com/intellij/vcs/log/graph/{GraphColorManagerImpl.kt,DefaultColorGenerator.kt}, java.awt.Color
// (RGBtoHSB/HSBtoRGB), theme values from platform/platform-resources/src/themes/expUI/expUI_{dark,light}.theme.json, Apache-2.0.

import type { GraphLayout } from "./linearGraph";

/** GraphColorManagerImpl.DEFAULT_COLOR: heads without refs. */
export const DEFAULT_COLOR = 0;

/** java.lang.String.hashCode */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * GraphColorGetterByHead + GraphColorManagerImpl: the head fragment of a branch gets the colour of its best ref name,
 * every other fragment the colour of its layout index.
 * @param headRefName best ref name of a head node (null when it has no ref)
 */
export function graphColorGetterByHead(layout: GraphLayout, headRefName: (headNodeId: number) => string | null) {
  return (nodeId: number, layoutIndex: number): number => {
    const headNodeId = nodeId < 0 ? 0 : layout.getOneOfHeadNodeIndex(nodeId);
    const headLayoutIndex = layout.getLayoutIndex(headNodeId);
    if (headLayoutIndex === layoutIndex) {
      const name = headRefName(headNodeId);
      return name == null ? DEFAULT_COLOR : javaStringHashCode(name);
    }
    return layoutIndex;
  };
}

// java.awt.Color, float (32 bit) arithmetic like Java
const f = Math.fround;

export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const cmax = Math.max(r, g, b);
  const cmin = Math.min(r, g, b);
  const brightness = f(cmax / 255);
  const saturation = cmax !== 0 ? f((cmax - cmin) / cmax) : 0;
  let hue: number;
  if (saturation === 0) hue = 0;
  else {
    const redc = f((cmax - r) / (cmax - cmin));
    const greenc = f((cmax - g) / (cmax - cmin));
    const bluec = f((cmax - b) / (cmax - cmin));
    if (r === cmax) hue = f(bluec - greenc);
    else if (g === cmax) hue = f(f(2 + redc) - bluec);
    else hue = f(f(4 + greenc) - redc);
    hue = f(hue / 6);
    if (hue < 0) hue = f(hue + 1);
  }
  return [hue, saturation, brightness];
}

export function hsbToRgb(hue: number, saturation: number, brightness: number): number {
  let r = 0;
  let g = 0;
  let b = 0;
  const c = (x: number) => Math.trunc(f(f(x * 255) + 0.5));
  if (saturation === 0) r = g = b = c(brightness);
  else {
    const h = f(f(hue - f(Math.floor(hue))) * 6);
    const fr = f(h - f(Math.floor(h)));
    const p = f(brightness * f(1 - saturation));
    const q = f(brightness * f(1 - f(saturation * fr)));
    const t = f(brightness * f(1 - f(saturation * f(1 - fr))));
    switch (Math.trunc(h)) {
      case 0: [r, g, b] = [c(brightness), c(t), c(p)]; break;
      case 1: [r, g, b] = [c(q), c(brightness), c(p)]; break;
      case 2: [r, g, b] = [c(p), c(brightness), c(t)]; break;
      case 3: [r, g, b] = [c(p), c(q), c(brightness)]; break;
      case 4: [r, g, b] = [c(t), c(p), c(brightness)]; break;
      case 5: [r, g, b] = [c(brightness), c(p), c(q)]; break;
    }
  }
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export interface GraphColorScheme {
  /** UIManager "VersionControl.Log.Graph.saturation" */
  saturation: number;
  /** UIManager "VersionControl.Log.Graph.brightness" */
  brightness: number;
  /** JBColor.BLACK (DEFAULT_COLOR): black in light themes, the label foreground in dark themes. */
  defaultColor: string;
}

/** New UI themes ("Dark", "Light"); "classic" are the DefaultColorGenerator defaults (Darcula / IntelliJ Light). */
export const GRAPH_COLORS_DARK: GraphColorScheme = { saturation: 0.6, brightness: 0.6, defaultColor: "#dfe1e5" };
export const GRAPH_COLORS_LIGHT: GraphColorScheme = { saturation: 0.6, brightness: 0.7, defaultColor: "#000000" };
export const GRAPH_COLORS_CLASSIC: GraphColorScheme = { saturation: 0.4, brightness: 0.65, defaultColor: "#000000" };

const rangeFix = (n: number) => Math.abs(n % 100) + 70;

/** DefaultColorGenerator.calcColor as 0xRRGGBB. */
export function graphColorRgb(colorId: number, scheme: GraphColorScheme = GRAPH_COLORS_DARK): number {
  const r = (Math.imul(colorId, 200) + 30) | 0;
  const g = (Math.imul(colorId, 130) + 50) | 0;
  const b = (Math.imul(colorId, 90) + 100) | 0;
  const [hue] = rgbToHsb(rangeFix(r), rangeFix(g), rangeFix(b));
  return hsbToRgb(hue, f(scheme.saturation), f(scheme.brightness));
}

const caches = new WeakMap<GraphColorScheme, Map<number, string>>();

/** CSS colour of a graph colour id. */
export function graphColor(colorId: number, scheme: GraphColorScheme | boolean = GRAPH_COLORS_DARK): string {
  const s = typeof scheme === "boolean" ? (scheme ? GRAPH_COLORS_DARK : GRAPH_COLORS_LIGHT) : scheme;
  if (colorId === DEFAULT_COLOR) return s.defaultColor;
  let cache = caches.get(s);
  if (!cache) caches.set(s, (cache = new Map()));
  let css = cache.get(colorId);
  if (css === undefined) cache.set(colorId, (css = "#" + graphColorRgb(colorId, s).toString(16).padStart(6, "0")));
  return css;
}
