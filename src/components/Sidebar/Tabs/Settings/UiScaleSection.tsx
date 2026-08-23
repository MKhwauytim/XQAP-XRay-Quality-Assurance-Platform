import { useState } from "react";
import { ChevronRight, Maximize2, RotateCcw } from "lucide-react";

import { useLabels } from "../../../../data/labels/useLabels";
import {
  MAX_TABLE_HEIGHT,
  MAX_UI_SCALE,
  MIN_TABLE_HEIGHT,
  MIN_UI_SCALE,
  resetUiScale,
  setUiScale,
} from "../../../../data/preferences/uiScaleStore";
import { useIsUiScaleCustomized, useUiScale } from "../../../../data/preferences/useUiScale";
// Same collapsible admin-settings card as SyncIntervalSection, reusing its
// stylesheet rather than cloning rules that would only drift.
import "./AdminAccountSection.css";

/** Slider granularity: 5% steps read as deliberate; 1% is fiddly and pointless. */
const STEP = 0.05;

function percent(value: number): string {
  return String(Math.round(value * 100));
}

/**
 * The app-wide UI scale editor (`src/data/preferences/uiScaleStore.ts`).
 *
 * Two sliders, both applied LIVE as they move. That is the whole design: the
 * thing being adjusted is how the page looks, so the page itself is the
 * preview, and a "save" step would only put a modal confirmation between the
 * operator and the feedback they need. Each move writes through the store,
 * which persists and re-applies the custom properties — so a drag that ends
 * anywhere is already saved, and there is no draft state to lose.
 *
 * Deliberately NOT gated on `canMutate` or on the real-admin check the way
 * `SyncIntervalSection` is, and the difference is not an oversight. Those gates
 * exist because that setting writes to the shared workspace, where one person's
 * change lands on everyone. This one writes to `localStorage` on this machine
 * only: it changes nothing another user can see, risks no data, and is undone
 * by one button. Gating it would mean an operator on a 1366×768 laptop — the
 * exact person the feature is for — could not fix their own screen. Reaching
 * the Settings tab at all is already role-restricted (`tabCatalog.ts`), which
 * is the level of gating a display preference warrants.
 */
export function UiScaleSection() {
  const labels = useLabels();
  const { scale, tableHeight } = useUiScale();
  const [isOpen, setIsOpen] = useState(false);

  const customized = useIsUiScaleCustomized();

  return (
    <div className="admin-account-section" dir="rtl">
      <button
        type="button"
        className={`admin-account-header${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span className="admin-account-icon"><Maximize2 size={16} /></span>
        <span className="admin-account-title">{labels.settings_uiscale_title}</span>
        <span className={`admin-account-chevron${isOpen ? " open" : ""}`}>
          <ChevronRight size={14} />
        </span>
      </button>

      {isOpen && (
        <div className="admin-account-body">
          <p className="admin-account-note">{labels.settings_uiscale_note}</p>

          <div className="admin-account-password-fields">
            <label>
              <span>
                {labels.settings_uiscale_field}
                {" — "}
                {labels.settings_uiscale_value.replace("{percent}", percent(scale))}
              </span>
              <input
                type="range"
                min={MIN_UI_SCALE}
                max={MAX_UI_SCALE}
                step={STEP}
                value={scale}
                aria-label={labels.settings_uiscale_field}
                aria-valuetext={labels.settings_uiscale_value.replace("{percent}", percent(scale))}
                onChange={(event) => setUiScale({ scale: Number(event.target.value) })}
              />
            </label>

            <label>
              <span>
                {labels.settings_uiscale_table_field}
                {" — "}
                {labels.settings_uiscale_value.replace("{percent}", percent(tableHeight))}
              </span>
              <input
                type="range"
                min={MIN_TABLE_HEIGHT}
                max={MAX_TABLE_HEIGHT}
                step={STEP}
                value={tableHeight}
                aria-label={labels.settings_uiscale_table_field}
                aria-valuetext={labels.settings_uiscale_value.replace(
                  "{percent}",
                  percent(tableHeight)
                )}
                onChange={(event) => setUiScale({ tableHeight: Number(event.target.value) })}
              />
            </label>
          </div>

          <p className="admin-account-hint">{labels.settings_uiscale_table_hint}</p>
          <p className="admin-account-hint">{labels.settings_uiscale_preview}</p>

          <button
            type="button"
            className="admin-account-save-btn"
            onClick={() => resetUiScale()}
            disabled={!customized}
          >
            <RotateCcw size={14} aria-hidden />
            {" "}
            {labels.settings_uiscale_reset}
          </button>
        </div>
      )}
    </div>
  );
}
