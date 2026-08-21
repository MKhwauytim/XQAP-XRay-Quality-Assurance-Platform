import { describe, expect, it } from "vitest";
import { hasRequiredSubTabFeature, SUB_TAB_FEATURE_MAP } from "./subTabFeatureGate";
import type { FeaturePermission } from "./userManagement";

function perms(overrides: Partial<Record<string, boolean>>): FeaturePermission[] {
  return Object.entries(overrides).map(([featureId, enabled]) => ({
    role: "employee" as const,
    featureId,
    enabled: enabled ?? false,
  }));
}

describe("hasRequiredSubTabFeature (audit finding 14)", () => {
  it("returns true for a sub-tab absent from SUB_TAB_FEATURE_MAP regardless of feature state", () => {
    expect(hasRequiredSubTabFeature("ew/xray-results", "employee", [])).toBe(true);
    expect(hasRequiredSubTabFeature("reports/kpi", "employee", [])).toBe(true);
  });

  it("returns false when a mapped sub-tab has none of its required features enabled", () => {
    expect(hasRequiredSubTabFeature("ew/xray-referrals", "employee", [])).toBe(false);
    expect(
      hasRequiredSubTabFeature(
        "ew/xray-referrals",
        "employee",
        perms({ "some-unrelated-feature": true })
      )
    ).toBe(false);
  });

  it("returns true when at least ONE required feature is enabled (OR semantics)", () => {
    expect(
      hasRequiredSubTabFeature("ew/xray-referrals", "employee", perms({ "view-all-entries": true }))
    ).toBe(true);
    expect(
      hasRequiredSubTabFeature("ew/referral-approval", "employee", perms({ "ew.reopenAnswer": true }))
    ).toBe(true);
  });

  it("gates population/adhoc-import on its two ad-hoc features (moved under Population 2026-08-21)", () => {
    expect([...SUB_TAB_FEATURE_MAP["population/adhoc-import"]].sort()).toEqual(
      ["adhoc-import.assign", "adhoc-import.ingest"].sort()
    );
    // A role holding Population view access but neither ad-hoc feature must not
    // get the sidebar link -- the page would refuse every action it offers.
    expect(hasRequiredSubTabFeature("population/adhoc-import", "manager", [])).toBe(false);
    expect(
      hasRequiredSubTabFeature("population/adhoc-import", "manager", [
        { role: "manager", featureId: "adhoc-import.ingest", enabled: true },
      ])
    ).toBe(true);
    // Admin passes on hasFeature's admin short-circuit, with no stored grants.
    expect(hasRequiredSubTabFeature("population/adhoc-import", "admin", [])).toBe(true);
    // The retired stand-alone id must carry no gate at all any more.
    expect(SUB_TAB_FEATURE_MAP["adhoc-import"]).toBeUndefined();
  });

  it("keeps the map in sync with what EmployeeWorkspaceTab actually checked before this fix", () => {
    expect([...SUB_TAB_FEATURE_MAP["ew/xray-referrals"]].sort()).toEqual(
      ["request-replacement", "submit-answers", "submit-referrals", "view-all-entries"].sort()
    );
    expect([...SUB_TAB_FEATURE_MAP["ew/referral-approval"]].sort()).toEqual(
      ["approve-referrals", "approve-replacements", "ew.reopenAnswer"].sort()
    );
  });
});
