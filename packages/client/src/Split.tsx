import { useRef, useState, type ReactNode } from "react";
import { getViewOptions, setViewOptions } from "./viewOptions";

/** Props of {@link Split}. */
export interface SplitProps {
  /** "row" = panes side by side, "column" = stacked. */
  direction: "row" | "column";
  /** Remembers the size in view options under this id. */
  id?: string;
  /** Size in px of the sized pane. */
  defaultSize: number;
  min?: number;
  max?: number;
  /** Which pane has the fixed size. Default "first". */
  sized?: "first" | "second";
  /** Hide the second pane (the first takes all space). */
  collapsed?: boolean;
  /** Hide the first pane (the second takes all space). Children stay mounted. */
  hideFirst?: boolean;
  children: [ReactNode, ReactNode];
}

/** Two panes with a draggable divider. */
export function Split({ direction, id, defaultSize, min = 80, max = 2000, sized = "first", collapsed, hideFirst, children }: SplitProps) {
  const [size, setSize] = useState(() => (id && getViewOptions().panelSizes[id]) || defaultSize);
  const ref = useRef<HTMLDivElement>(null);
  const row = direction === "row";

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const total = row ? rect.width : rect.height;
    const start = row ? e.clientX : e.clientY;
    const startSize = size;
    let last = size;
    const move = (ev: PointerEvent) => {
      const d = (row ? ev.clientX : ev.clientY) - start;
      last = Math.round(Math.max(min, Math.min(max, total - 40, startSize + (sized === "first" ? d : -d))));
      setSize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      if (id) setViewOptions({ panelSizes: { ...getViewOptions().panelSizes, [id]: last } });
    };
    document.body.style.cursor = row ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const fixed = { flex: `0 0 ${size}px` };
  return (
    <div ref={ref} className={`gitnut-split gitnut-split-${direction}`}>
      <div className="gitnut-split-pane" style={hideFirst ? { display: "none" } : sized === "first" && !collapsed ? fixed : undefined}>
        {children[0]}
      </div>
      {!collapsed && (
        <>
          <div className="gitnut-split-handle" hidden={hideFirst} role="separator" aria-orientation={row ? "vertical" : "horizontal"} onPointerDown={onPointerDown} />
          <div className="gitnut-split-pane" style={sized === "second" ? fixed : undefined}>
            {children[1]}
          </div>
        </>
      )}
    </div>
  );
}
