/* @vitest-environment jsdom */
// C3: the «الحصة اليومية» tile shows the frozen quota; its strings are label
// keys (admin-overridable in Settings), and its title names the working-day
// window instead of "الأيام المتبقية".
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetLabel, setLabel } from "../../../../../../data/labels/labelsStore";
import type { PersonalStats } from "../XrayReferrals";
import { ReferralStatsStrip } from "./subComponents";

const STATS: PersonalStats = {
  assigned: 40,
  submitted: 10,
  onHold: 0,
  notStarted: 30,
  replaced: 0,
  active: 40,
  completionPct: 25,
  completedToday: 2,
};
const QUOTA = { dailyQuota: 3, daysRemaining: 19, sampleCount: 40 };

afterEach(() => {
  cleanup();
  resetLabel("ew_quota_tile_label");
});

describe("«الحصة اليومية» tile (C3)", () => {
  it("shows the daily quota under its label, with the working-day window in the title", () => {
    const { container } = render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="emp-1" />);
    expect(screen.getByText("الحصة اليومية")).toBeInTheDocument();
    expect(container.querySelector(".ew-ref-stats-title")?.getAttribute("title")).toBe(
      "الحصة اليومية: 3 صورة / يوم · الحصة: 40 · أيام العمل (الأحد–الخميس): 19",
    );
  });

  it("labels the quota as the reader's own under a foreign scope", () => {
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="sup-1" scope="all" />);
    expect(screen.getByText("الحصة اليومية (لي)")).toBeInTheDocument();
  });

  it("uses the no-quota label when there is no quota", () => {
    const { container } = render(<ReferralStatsStrip stats={STATS} quota={null} username="emp-1" />);
    expect(container.querySelector(".ew-ref-stats-title")?.getAttribute("title")).toBe(
      "لا توجد حصة محفوظة لهذا الشهر",
    );
  });

  it("shows «المنجز اليوم» with done / daily quota in its title under own scope", () => {
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="emp-1" />);
    const tile = screen.getByText("المنجز اليوم").closest(".ew-ref-stat-token");
    expect(tile?.querySelector("strong")?.textContent).toBe("2");
    expect(tile?.getAttribute("title")).toBe("المنجز اليوم: 2 / الحصة اليومية: 3");
  });

  it("does not compare a team «المنجز اليوم» against the reader's own quota", () => {
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="sup-1" scope="all" />);
    const tile = screen.getByText("المنجز اليوم").closest(".ew-ref-stat-token");
    expect(tile?.getAttribute("title")).toBe("المنجز اليوم: 2");
  });

  it("reads the tile label from the labels store (admin-overridable)", () => {
    setLabel("ew_quota_tile_label", "حصتي اليومية");
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="emp-1" />);
    expect(screen.getByText("حصتي اليومية")).toBeInTheDocument();
  });
});
