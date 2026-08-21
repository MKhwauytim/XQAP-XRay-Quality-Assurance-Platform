/* @vitest-environment jsdom */
// Regression: the checklist reappearing on a mid-session TAB SWITCH.
//
// BootSplashOverlay.test.tsx already covers "a later, unrelated registration
// must not re-show the checklist" -- but only along the path where the FIRST
// checklist actually appeared and was dismissed. `dismissed` is what suppresses
// the later registration there.
//
// The path below is the one real users hit: the landing tab registers NOTHING
// (Population with no month selected registers no boot sources), so the
// checklist never appears, `shown` never latches, `shownAtRef` is never
// stamped -- and the dismissal effect returns early at `if (shownAt === null)`,
// leaving `dismissed` false for the whole session. When the user then navigates
// to Employee Workspace, XrayReferrals.tsx registers its sources for the first
// time (its `bootReportedRef` initial-load branch), `allLoaded` drops back to
// false, and nothing is left holding the overlay back.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  markBootSourceLoading,
  registerBootSources,
  resetBootProgress,
} from "../../data/workspace/bootProgress";
import { BootSplashOverlay } from "./BootSplashOverlay";

const SESSION = "amal:2026-08-13T09:00:00.000Z:workspace-a";

// Production defaults, not the 0/short values the sibling suite uses -- the
// timing IS the bug here, so the real 8000/600 must be what's exercised.
const TIMEOUT_MS = 8000;
const MIN_VISIBLE_MS = 600;

beforeEach(() => {
  resetBootProgress();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetBootProgress();
  vi.useRealTimers();
});

function renderOverlay() {
  const result = render(
    <BootSplashOverlay bootSessionKey={SESSION} timeoutMs={TIMEOUT_MS} minVisibleMs={MIN_VISIBLE_MS}>
      <div data-testid="app-content">التطبيق يعمل</div>
    </BootSplashOverlay>
  );
  // App.tsx's useLayoutEffect, which always lands before any child registers.
  act(() => {
    resetBootProgress();
  });
  return result;
}

// What XrayReferrals.tsx does on its first data-fetching pass.
function employeeWorkspaceRegistersItsSources() {
  act(() => {
    registerBootSources([
      { key: "referrals_sample_master", labelAr: "العينة الرئيسية", labelEn: "sample.master.json" },
      { key: "referrals_answers", labelAr: "الإجابات", labelEn: "answers.json" },
    ]);
    markBootSourceLoading("referrals_sample_master");
    markBootSourceLoading("referrals_answers");
  });
}

describe("BootSplashOverlay -- late registration after a checklist-less landing", () => {
  // Fixed by the per-session boot WINDOW (`bootWindowMs`, default 2000ms): the
  // checklist may only make its FIRST appearance while that window is open. It
  // closes on the timer, or earlier on the user's first pointerdown/keydown --
  // and every late-registration trigger in the app (tab switch, month switch)
  // starts with exactly one of those.
  //
  // Before the fix, the sibling case further down passed only because `timedOut`
  // had already latched by then -- the safety valve, not the dismissal logic, was
  // what covered it. The unprotected window was therefore the first `timeoutMs`
  // (8s) after login, which is exactly when a real user makes their first tab
  // switch.
  it("stays hidden when the landing tab registered nothing and the user switches tabs a few seconds later", () => {
    renderOverlay();

    // Landing tab (Population, no month selected) registers no sources at all,
    // so the checklist correctly never appears.
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // A few seconds pass -- deliberately still inside timeoutMs, which is the
    // only latch left standing on this path.
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // User clicks through to Employee Workspace.
    employeeWorkspaceRegistersItsSources();

    // Same boot session, user is long past login: the checklist is a
    // post-login courtesy and must not cover the app they're working in.
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("still shows for a genuine landing-tab registration inside the boot window", () => {
    // The guard above must not become "never show the checklist": a landing tab
    // that registers promptly, with no user interaction in between, is the whole
    // reason this component exists.
    renderOverlay();

    act(() => {
      vi.advanceTimersByTime(400); // a realistic landing-load delay, inside the window
    });
    employeeWorkspaceRegistersItsSources();

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("stays hidden when the user clicks through to another tab while the boot window is still open", () => {
    // The timer alone leaves a hole: a fast user can reach a second tab well
    // inside `bootWindowMs`. The pointerdown that starts that navigation lands
    // (capture phase) before React commits the tab switch, so it closes the
    // window ahead of the new tab's registration.
    renderOverlay();

    act(() => {
      vi.advanceTimersByTime(300); // still inside the 2000ms boot window
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    employeeWorkspaceRegistersItsSources();

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("also stays hidden when the same tab switch happens after timeoutMs has elapsed", () => {
    renderOverlay();
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // Past the safety valve this time.
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);
    });

    employeeWorkspaceRegistersItsSources();

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });
});
