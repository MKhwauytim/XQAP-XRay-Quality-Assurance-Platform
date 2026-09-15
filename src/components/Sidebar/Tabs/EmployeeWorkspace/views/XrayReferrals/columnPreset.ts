/**
 * Column-layout config and preset persistence for the referrals queue.
 *
 * WHY THIS IS ITS OWN MODULE. Two things, and the second is why it is a module
 * rather than one more helper inside the component file.
 *
 * 1. `XrayReferrals` is governed by a `max-lines-per-function` regression budget
 *    (1450, enforced by `npm run check:complexity` in CI). It has crossed that
 *    line before and was refactored back under it in 9a482a0, which left only
 *    three lines of headroom — so the next few fixes put it straight back over,
 *    at 1467. Extracting a cohesive block, rather than raising the ceiling, is
 *    the precedent that commit set; this one deliberately takes a bigger bite so
 *    the budget is not re-breached by the next one-line change.
 *
 * 2. The preset OBJECT was built twice from the same four fields — once in the
 *    split-resizer commit and once in `onColConfigChange`, ~1000 lines apart —
 *    with the `visibleColumns` derivation (`baseColumns` minus `cfg.hidden`)
 *    duplicated verbatim in both. CLAUDE.md's "no duplicate state — one place,
 *    one name, called everywhere" rule is explicit that this is how a shape
 *    drifts. `buildReferralColumnPreset` is now the single definition.
 *
 * No behaviour change: the same fields are written to the same two stores, in
 * the same order, under the same permission condition.
 */

import type { ColConfig, DataTableCol } from "../../../../../../components/DataTable";
import {
  saveAdminBrowseDatasetPreset,
  saveUserBrowseDatasetPreset,
} from "../../../../../../data/preferences/browsePresetStorage";
import { REFERRALS_PRESET_KEY } from "./subComponents";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";

/** The persisted shape of one dataset's column layout. */
export type ReferralColumnPreset = {
  columnOrder: ColConfig["order"];
  visibleColumns: string[];
  widths: ColConfig["widths"];
  dateFmt: ColConfig["dateFmt"];
  layout?: { ratio: number };
};

/**
 * Build the preset payload from a column config.
 *
 * `visibleColumns` is derived rather than stored: `ColConfig` tracks what is
 * HIDDEN, and the preset records what is VISIBLE, so the full column set has to
 * be subtracted against. That inversion is exactly the detail that was copied
 * into two places and is the reason this is one function.
 */
export function buildReferralColumnPreset<T>(
  config: ColConfig,
  baseColumns: readonly DataTableCol<T>[],
  layout?: { ratio: number }
): ReferralColumnPreset {
  const preset: ReferralColumnPreset = {
    columnOrder: config.order,
    visibleColumns: baseColumns
      .map((column) => column.id)
      .filter((id) => !config.hidden.includes(id)),
    widths: config.widths,
    dateFmt: config.dateFmt,
  };
  return layout ? { ...preset, layout } : preset;
}

/**
 * Persist a column layout.
 *
 * Every user always writes their OWN layout (isolated per user); a user who may
 * configure columns additionally updates the shared default that everyone else
 * starts from. Both writes are fire-and-forget by design — a layout preference
 * must never block or fail the queue interaction that produced it.
 */
export function persistReferralColumnPreset(params: {
  directoryHandle: DirectoryHandleLike;
  username: string;
  canConfigureColumns: boolean;
  preset: ReferralColumnPreset;
}): void {
  const { directoryHandle, username, canConfigureColumns, preset } = params;
  void saveUserBrowseDatasetPreset(directoryHandle, username, REFERRALS_PRESET_KEY, preset);
  if (canConfigureColumns) {
    void saveAdminBrowseDatasetPreset(directoryHandle, REFERRALS_PRESET_KEY, preset);
  }
}

/**
 * Persist ONLY the shared split ratio, carrying the current column fields along.
 *
 * The resizer's drag and the column picker write the same one preset object per
 * dataset, so a ratio-only save still has to send the column fields or it would
 * blank them for everyone. That coupling is the whole reason these two callers
 * share `buildReferralColumnPreset`.
 */
export function persistReferralSplitRatio<T>(params: {
  directoryHandle: DirectoryHandleLike;
  config: ColConfig;
  baseColumns: readonly DataTableCol<T>[];
  ratio: number;
}): void {
  const { directoryHandle, config, baseColumns, ratio } = params;
  void saveAdminBrowseDatasetPreset(
    directoryHandle,
    REFERRALS_PRESET_KEY,
    buildReferralColumnPreset(config, baseColumns, { ratio })
  );
}
