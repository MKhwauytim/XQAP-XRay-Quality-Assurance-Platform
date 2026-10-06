import type { Labels } from "../../../../../data/labels/labelsStore";
import type { ComprehensiveSourceMode } from "./sourceMode";

interface SourceModeSwitchProps {
  labels: Labels;
  mode: ComprehensiveSourceMode;
  onChange: (mode: ComprehensiveSourceMode) => void;
}

/** Two-option data-source switch: native radios inside a labelled radiogroup (arrow keys work natively). */
export function SourceModeSwitch({ labels, mode, onChange }: SourceModeSwitchProps) {
  const options: Array<{ value: ComprehensiveSourceMode; label: string }> = [
    { value: "app+excel", label: labels.ce_source_app_excel },
    { value: "excel-only", label: labels.ce_source_excel_only },
  ];
  return (
    <div className="ce-card" data-testid="ce-source-switch">
      <h2 className="ce-card-subtitle" id="ce-source-title">{labels.ce_source_title}</h2>
      <div className="ce-row" role="radiogroup" aria-labelledby="ce-source-title">
        {options.map((o) => (
          <label key={o.value} className="ce-radio">
            <input
              type="radio"
              name="ce-source-mode"
              value={o.value}
              checked={mode === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
