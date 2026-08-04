/* @vitest-environment jsdom */
// BootSplashOverlay -- post-login "data source checklist" overlay. Shown
// briefly right after login while the named on-disk sources registered via
// bootProgress.ts (Task 1) are still loading, so the user sees named
// progress instead of an in-task freeze later. The overlay is purely
// visual: `children` (the real app) is ALWAYS mounted underneath, so the
// landing tab's own effects run on schedule regardless of whether the
// checklist is still showing.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  markBootSourceError,
  markBootSourceLoaded,
  markBootSourceLoading,
  registerBootSources,
  resetBootProgress,
} from "../../data/workspace/bootProgress";
import { BootSplashOverlay } from "./BootSplashOverlay";

beforeEach(() => {
  resetBootProgress();
});

afterEach(() => {
  cleanup();
  resetBootProgress();
  vi.useRealTimers();
});

const SESSION_ONE = "amal:2026-08-04T09:00:00.000Z:workspace-a";
const SESSION_TWO = "amal:2026-08-04T14:30:00.000Z:workspace-a";

function overlay(bootSessionKey: string, timeoutMs?: number) {
  return (
    <BootSplashOverlay bootSessionKey={bootSessionKey} timeoutMs={timeoutMs}>
      <div data-testid="app-content">التطبيق يعمل</div>
    </BootSplashOverlay>
  );
}

function renderOverlay(timeoutMs?: number, bootSessionKey = SESSION_ONE) {
  return render(overlay(bootSessionKey, timeoutMs));
}

describe("BootSplashOverlay", () => {
  it("keeps the real app mounted underneath the checklist while a source is still loading", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population");

    renderOverlay();

    // Assert the app's PRESENCE, not the overlay's absence -- the whole
    // point of this overlay is that it sits on top of an app that is
    // already running, not that it delays mounting the app.
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("shows the real on-disk file name (labelEn) alongside the Arabic label (labelAr) for each source", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population");

    renderOverlay();

    expect(screen.getByText("بيانات السكان")).toBeInTheDocument();
    expect(screen.getByText("population.final.json")).toBeInTheDocument();
  });

  it("clears the overlay once every registered source has loaded, while the app stays mounted", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      { key: "sample", labelAr: "بيانات العينة", labelEn: "sample.master.json" },
    ]);
    markBootSourceLoading("population");
    markBootSourceLoading("sample");

    renderOverlay();
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      markBootSourceLoaded("population");
      markBootSourceLoaded("sample");
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("clears the overlay after timeoutMs even when a source never finishes loading", () => {
    vi.useFakeTimers();
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population"); // deliberately never resolved in this test

    renderOverlay(50);
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("does not clear the overlay before timeoutMs elapses while sources are still pending", () => {
    vi.useFakeTimers();
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    renderOverlay(1000);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("shows an error indicator for a failed source without blocking the overlay from later clearing", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      { key: "sample", labelAr: "بيانات العينة", labelEn: "sample.master.json" },
    ]);
    markBootSourceLoading("population");
    markBootSourceLoading("sample");

    const { container } = renderOverlay();

    act(() => {
      markBootSourceError("population", "الملف غير موجود");
    });

    // Overlay must still be showing -- "sample" hasn't finished -- and the
    // failed entry must render a visibly distinct error indicator.
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
    expect(container.querySelector(".boot-splash-item--error")).not.toBeNull();

    // Per Task 1's allLoaded semantics, "error" is a terminal status too --
    // it must not hang the checklist forever. Once the remaining source also
    // reaches a terminal state, the overlay clears despite the earlier failure.
    act(() => {
      markBootSourceLoaded("sample");
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
  });

  // ── Exactly once per boot session ──────────────────────────────────────────
  // The store behind useBootProgress is app-wide and long-lived: useMonthLoad
  // re-registers on every genuine month switch, and XrayReferrals registers on
  // its own first mount (often long after login, when the user first navigates
  // to Employee Workspace). Neither may put the checklist back over an app the
  // user is already working in.

  it("stays hidden when a LATER, unrelated registration re-populates the store mid-session", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population");

    renderOverlay();
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      markBootSourceLoaded("population");
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // Minutes later, some other tab the user has just navigated to registers
    // its own sources for the first time. Same boot session -- the checklist
    // is spent and must not cover the running app again.
    act(() => {
      registerBootSources([
        { key: "referrals_sample_master", labelAr: "العينة الرئيسية", labelEn: "sample.master.json" },
      ]);
      markBootSourceLoading("referrals_sample_master");
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("shows again for a genuinely new boot session (fresh login / workspace switch)", () => {
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population");

    const { rerender } = renderOverlay();
    act(() => {
      markBootSourceLoaded("population");
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // A new session: App.tsx clears the store, then the new session's landing
    // tab registers its own sources from its own mount effect.
    act(() => {
      resetBootProgress();
    });
    rerender(overlay(SESSION_TWO));
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("re-arms the timeout on a new boot session instead of inheriting a spent one", () => {
    vi.useFakeTimers();
    registerBootSources([
      { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
    ]);
    markBootSourceLoading("population"); // deliberately never resolved

    const { rerender } = renderOverlay(50);
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // This component is never remounted across a login/workspace switch (only
    // its children's contents change), so a mount-scoped timeout could only
    // ever fire once -- leaving every later session with a permanently-spent
    // safety valve AND a permanently-suppressed checklist.
    act(() => {
      resetBootProgress();
    });
    rerender(overlay(SESSION_TWO, 50));
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population"); // again never resolved
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    // ...and the fresh session's own grace period still bounds it.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("does not retire the checklist off the vacuously-loaded empty store it starts every boot with", () => {
    // Nothing registered yet -- allLoaded is vacuously true. If that counted as
    // "the checklist ran its course", the landing tab's registration a moment
    // later (its own mount effect, always after this component's first render)
    // would arrive to a permanently-dismissed overlay.
    renderOverlay();
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });
});
