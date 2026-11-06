const KEYS: [string, string][] = [
  ["↑ ↓", "Move through commits and files"],
  ["Shift+↑ ↓, Shift+click", "Extend the commit selection"],
  ["Ctrl/Cmd+click", "Add or remove a commit"],
  ["← →", "Collapse / expand folders"],
  ["Enter, double-click", "Open the diff"],
  ["Ctrl/Cmd+D", "Open the diff in a large view"],
  ["F7 / Shift+F7", "Next / previous change; again at the end goes to the next / previous file"],
  ["Space", "Include or exclude a file from the commit"],
  ["Ctrl/Cmd+Enter", "Commit"],
  ["Esc", "Close a dialog or the large diff"],
  ["?", "This list"],
];

/** Keyboard shortcut reference. */
export function Shortcuts() {
  return (
    <dl className="gitnut-shortcuts">
      {KEYS.map(([k, v]) => (
        <div key={k}>
          <dt>
            {k.split(", ").map((x) => (
              <kbd key={x}>{x}</kbd>
            ))}
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
