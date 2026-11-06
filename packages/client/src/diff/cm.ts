import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, lineNumbers } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";

const v = (name: string) => `var(--gitnut-syntax-${name})`;

/** Syntax colours from the theme's `colors.syntax` tokens (IntelliJ New UI defaults). */
export const gitnutHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.bool, t.null, t.self], color: v("keyword") },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: v("string") },
  { tag: [t.number, t.integer, t.float, t.atom, t.color, t.unit], color: v("number") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v("comment"), fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: v("function") },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.typeName)], color: v("type") },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName), t.labelName], color: v("property") },
  { tag: [t.variableName, t.definition(t.variableName)], color: v("variable") },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: v("operator") },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.macroName], color: v("meta") },
  { tag: t.heading, fontWeight: "600", color: v("keyword") },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.invalid, color: "var(--gitnut-danger)" },
]);

/** Editor chrome: transparent background, theme fonts, gutter colours. */
export const gitnutEditorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--gitnut-text)", fontSize: "var(--gitnut-font-size-sm)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--gitnut-font-mono)", lineHeight: "1.55" },
  ".cm-content": { padding: "4px 0", caretColor: "transparent" },
  ".cm-gutters": { backgroundColor: "transparent", color: "color-mix(in srgb, var(--gitnut-muted-text) 70%, transparent)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "36px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--gitnut-selection) !important" },
  "::selection": { backgroundColor: "var(--gitnut-selection)" },
});

/** Read-only base extensions of every diff editor. */
export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    gitnutEditorTheme,
    syntaxHighlighting(gitnutHighlight),
  ];
}

const loaded = new Map<string, Promise<LanguageSupport | null>>();

/** Language support for a file path (lazy loaded, cached). */
export function languageFor(path: string): Promise<LanguageSupport | null> {
  const name = path.split("/").pop() ?? path;
  const desc = LanguageDescription.matchFilename(languages, name);
  if (!desc) return Promise.resolve(null);
  let p = loaded.get(desc.name);
  if (!p) loaded.set(desc.name, (p = desc.load().catch(() => null)));
  return p;
}
