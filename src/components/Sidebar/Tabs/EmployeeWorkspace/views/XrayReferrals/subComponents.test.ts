import { describe, expect, it } from "vitest";
import type { ColConfig, DataTableCol } from "../../../../../../components/DataTable";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { getVisibleReferralColumns, SELECT_COL_ID } from "./subComponents";

function col(
  id: string,
  overrides: Partial<DataTableCol<DistributionEntry>> = {}
): DataTableCol<DistributionEntry> {
  return { id, label: id, accessor: () => null, ...overrides };
}

function cfg(overrides: Partial<ColConfig> = {}): ColConfig {
  return { order: [], hidden: [], dateFmt: {}, widths: {}, ...overrides };
}

describe("getVisibleReferralColumns", () => {
  it("appends a column added to buildXrayColumns after the preset was saved, instead of dropping it", () => {
    // Regression test for the drift bug: a saved layout's cfg.order predates a
    // newly added non-alwaysVisible column ("reportNumber") — it must be appended
    // to the referral-request preview, not silently dropped forever.
    const columns = [
      col("xrayImageId", { alwaysVisible: true }),
      col("stage"),
      col("reportNumber"),
    ];
    const savedCfg = cfg({ order: ["xrayImageId", "stage"] });

    const visible = getVisibleReferralColumns(columns, savedCfg, false);

    expect(visible.map((c) => c.id)).toEqual(["xrayImageId", "stage", "reportNumber"]);
  });

  it("prepends an alwaysVisible column missing from a saved order", () => {
    const columns = [col("xrayImageId", { alwaysVisible: true }), col("stage")];
    const savedCfg = cfg({ order: ["stage"] });

    const visible = getVisibleReferralColumns(columns, savedCfg, false);

    expect(visible.map((c) => c.id)).toEqual(["xrayImageId", "stage"]);
  });

  it("keeps the saved relative order for ids already present in cfg.order", () => {
    const columns = [col("a"), col("b"), col("c")];
    const savedCfg = cfg({ order: ["c", "a", "b"] });

    const visible = getVisibleReferralColumns(columns, savedCfg, false);

    expect(visible.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("excludes columns hidden via cfg.hidden", () => {
    const columns = [col("a"), col("b")];
    const savedCfg = cfg({ order: ["a", "b"], hidden: ["b"] });

    const visible = getVisibleReferralColumns(columns, savedCfg, false);

    expect(visible.map((c) => c.id)).toEqual(["a"]);
  });

  it("excludes adminOnly columns unless isAdmin is true", () => {
    const columns = [col("a"), col("assignedTo", { adminOnly: true })];
    const savedCfg = cfg({ order: ["a", "assignedTo"] });

    expect(getVisibleReferralColumns(columns, savedCfg, false).map((c) => c.id)).toEqual(["a"]);
    expect(getVisibleReferralColumns(columns, savedCfg, true).map((c) => c.id)).toEqual(["a", "assignedTo"]);
  });

  it("always excludes the row-select sentinel column even if present in columns", () => {
    const columns = [col(SELECT_COL_ID, { alwaysVisible: true }), col("a")];
    const savedCfg = cfg({ order: ["a"] });

    const visible = getVisibleReferralColumns(columns, savedCfg, false);

    expect(visible.map((c) => c.id)).toEqual(["a"]);
  });
});
