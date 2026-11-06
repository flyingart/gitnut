import { Check, Moon, Sun } from "lucide-react";
import { ACCENTS, accentTheme } from "./theme";
import { GitnutRoot, type StyleProps } from "./root";
import { Segmented } from "./ui";
import { useViewOptions } from "./viewOptions";
import { Checkbox, Field, Section } from "./form";

/** Props of {@link AppearancePanel}. */
export interface AppearancePanelProps extends StyleProps {}

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/**
 * Colour scheme and accent of the full app, remembered per browser (view options `scheme` and
 * `accent`). `GitnutApp` applies them unless the host passes its own `theme`.
 */
export function AppearancePanel(props: AppearancePanelProps) {
  const { options, set } = useViewOptions();
  const custom = !(options.accent in ACCENTS);
  return (
    <GitnutRoot component="appearance" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      <div className="gitnut-form">
        <Section title="Appearance">
          <Field as="div" label="Theme">
            <Segmented
              label="Theme"
              value={options.scheme}
              onChange={(v) => set("scheme", v)}
              options={[
                { value: "dark", label: "Dark", icon: <Moon size={12} /> },
                { value: "light", label: "Light", icon: <Sun size={12} /> },
              ]}
            />
          </Field>
          <Field as="div" label="Accent" hint="Buttons, selection, focus rings and the background glow. Remembered in this browser.">
            <div className="gitnut-swatches" role="radiogroup" aria-label="Accent colour">
              {Object.entries(ACCENTS).map(([name, a]) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={options.accent === name}
                  title={a.label}
                  aria-label={a.label}
                  className="gitnut-swatch"
                  style={{ background: accentTheme(name).colors!.gradient }}
                  onClick={() => set("accent", name)}
                >
                  {options.accent === name && <Check size={13} />}
                </button>
              ))}
              <label className="gitnut-swatch gitnut-swatch-custom" title="Custom colour" style={custom ? { background: accentTheme(options.accent).colors!.gradient } : undefined}>
                {custom && <Check size={13} />}
                <input type="color" aria-label="Custom accent colour" value={custom && isHex(options.accent) ? options.accent : "#8b5cf6"} onChange={(e) => set("accent", e.target.value)} />
              </label>
            </div>
          </Field>
          <Checkbox checked={options.showTabs} onChange={(v) => set("showTabs", v)}>
            Open projects in tabs (right-click a tab to close others, to the left or right)
          </Checkbox>
        </Section>
      </div>
    </GitnutRoot>
  );
}
