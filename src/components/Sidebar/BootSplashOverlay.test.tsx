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
  // Global, not opt-in per test: dismissal always routes through a
  // window.setTimeout now (even a 0ms one, when the minVisibleMs floor has
  // already elapsed) so the effect that calls it never calls setState
  // synchronously in its own body (react-hooks/set-state-in-effect). Every
  // test that expects a dismissal must advance past that timer explicitly --
  // see the `act(() => vi.advanceTimersByTime(0))` calls below.
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetBootProgress();
  vi.useRealTimers();
});

const SESSION_ONE = "amal:2026-08-04T09:00:00.000Z:workspace-a";
const SESSION_TWO = "amal:2026-08-04T14:30:00.000Z:workspace-a";

// minVisibleMs defaults to 0 here (unlike the component's own 600ms default)
// so every test not specifically about the floor can keep asserting on
// immediate dismissal -- only the dedicated minVisibleMs tests below pass a
// non-zero value.
function overlay(bootSessionKey: string, timeoutMs?: number, minVisibleMs = 0) {
  return (
    <BootSplashOverlay bootSessionKey={bootSessionKey} timeoutMs={timeoutMs} minVisibleMs={minVisibleMs}>
      <div data-testid="app-content">التطبيق يعمل</div>
    </BootSplashOverlay>
  );
}

// Mounts, then simulates App.tsx's own useLayoutEffect -- which always calls
// resetBootProgress() once, right after mount, before any child's own
// registration effect runs. BootSplashOverlay's dataIsFresh gate now
// requires this to have happened even on the component's own first mount
// (a real regression found by an independent review: the component CAN
// remount in production with the shared store still holding a previous
// session's data -- the admin role-preview switch remounts AppContent via
// `key={session.role}`, and logout->login remounts it via AuthGate -- so
// "this is the very first arm, nothing to guard against" was never actually
// safe to assume). Callers register sources AFTER this returns, mirroring
// the real order: reset, then the landing tab's own mount effect registers.
function renderOverlay(timeoutMs?: number, bootSessionKey = SESSION_ONE, minVisibleMs = 0) {
  const result = render(overlay(bootSessionKey, timeoutMs, minVisibleMs));
  act(() => {
    resetBootProgress();
  });
  return result;
}

// Advances a session already on screen to a NEW one, in the real production
// order: the session-key prop changes first (App.tsx's reset lives in a
// useLayoutEffect keyed on the very same identity, so it always fires
// strictly after this component observes the new key, never before), THEN
// the reset lands. Callers register the new session's sources afterward.
function rerenderNewSession(
  rerender: (ui: ReturnType<typeof overlay>) => void,
  bootSessionKey: string,
  timeoutMs?: number,
  minVisibleMs = 0
) {
  rerender(overlay(bootSessionKey, timeoutMs, minVisibleMs));
  act(() => {
    resetBootProgress();
  });
}

describe("BootSplashOverlay", () => {
  it("keeps the real app mounted underneath the checklist while a source is still loading", () => {
    renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    // Assert the app's PRESENCE, not the overlay's absence -- the whole
    // point of this overlay is that it sits on top of an app that is
    // already running, not that it delays mounting the app.
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("shows the real on-disk file name (labelEn) alongside the Arabic label (labelAr) for each source", () => {
    renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    expect(screen.getByText("بيانات السكان")).toBeInTheDocument();
    expect(screen.getByText("population.final.json")).toBeInTheDocument();
  });

  it("clears the overlay once every registered source has loaded, while the app stays mounted", () => {
    renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
        { key: "sample", labelAr: "بيانات العينة", labelEn: "sample.master.json" },
      ]);
      markBootSourceLoading("population");
      markBootSourceLoading("sample");
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      markBootSourceLoaded("population");
      markBootSourceLoaded("sample");
    });
    // Dismissal is routed through a (possibly 0ms) setTimeout -- see the
    // top-of-file beforeEach comment.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("clears the overlay after timeoutMs even when a source never finishes loading", () => {
    renderOverlay(50);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population"); // deliberately never resolved in this test
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("does not clear the overlay before timeoutMs elapses while sources are still pending", () => {
    renderOverlay(1000);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("shows an error indicator for a failed source without blocking the overlay from later clearing", () => {
    const { container } = renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
        { key: "sample", labelAr: "بيانات العينة", labelEn: "sample.master.json" },
      ]);
      markBootSourceLoading("population");
      markBootSourceLoading("sample");
    });

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
    act(() => {
      vi.advanceTimersByTime(0);
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
    renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      markBootSourceLoaded("population");
    });
    act(() => {
      vi.advanceTimersByTime(0);
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
    const { rerender } = renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    act(() => {
      markBootSourceLoaded("population");
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // A new session: the session-key prop changes first, then the reset
    // lands (real production ordering -- see rerenderNewSession), then the
    // new session's landing tab registers its own sources from its own
    // mount effect.
    rerenderNewSession(rerender, SESSION_TWO);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("re-arms the timeout on a new boot session instead of inheriting a spent one", () => {
    const { rerender } = renderOverlay(50);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population"); // deliberately never resolved
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // A same-instance session change (this test's `rerenderNewSession`, no
    // remount) is the case per-session re-arming exists for -- a genuine
    // remount would already get a fresh timer for free. A mount-scoped-only
    // timeout would leave a same-instance session change with a
    // permanently-spent safety valve AND a permanently-suppressed checklist.
    rerenderNewSession(rerender, SESSION_TWO, 50);
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

  it("shows again for a new boot session even when the store reset lands AFTER the key change lands (real production ordering, C-A regression)", () => {
    // The store reset lives in App.tsx's useLayoutEffect, which by
    // definition fires AFTER the render in which `bootSessionKey` changes,
    // not before it. At the moment this component re-renders with
    // SESSION_TWO, the store still holds SESSION_ONE's (fully loaded)
    // entries -- if the per-session latch used that stale data to decide it
    // had "already run its course," the checklist would never open for the
    // new session at all, silently reproducing the original never-shows bug
    // in a different place. This test pins that ordering down explicitly,
    // asserting the intermediate (still-stale) state before the reset lands.
    const { rerender } = renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    act(() => {
      markBootSourceLoaded("population");
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // Real ordering: the new session's key lands on this component FIRST,
    // while the store still holds the previous session's stale, fully-loaded
    // entries -- the reset hasn't run yet.
    rerender(overlay(SESSION_TWO));
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    // THEN the reset lands (App.tsx's useLayoutEffect), clearing the store...
    act(() => {
      resetBootProgress();
    });
    // ...and only then does the new session's landing tab register its own
    // sources from its own mount effect.
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });

    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  it("shows again after a REMOUNT with the store still holding the previous session's non-terminal data (regression: staleGeneration must not skip the guard on mount)", () => {
    // A remount (admin role-preview switch via App.tsx's `key={session.role}`,
    // or logout->login via AuthGate) is a fresh BootSplashOverlay instance --
    // `useState`'s initializer runs again. If it treated that as "nothing to
    // guard against," it would latch `shown` off whatever the shared store
    // (module-level, outlives any one component instance) still holds from
    // the session that was just torn down -- exactly the bug this component
    // was built to prevent, just moved to the mount path instead of a
    // same-instance session change.
    const { unmount } = renderOverlay();
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population"); // left non-terminal, deliberately never loaded
    });
    unmount();
    // The store is untouched by unmount -- it's module state, not component
    // state -- so it still holds the "population: loading" entry here.

    renderOverlay(); // a fresh instance; its OWN resetBootProgress() call is what must clear this
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();

    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();
  });

  // ── Minimum-visible-duration floor ──────────────────────────────────────────
  // The always-registered sources (month.manifest.json, processing.summary.json,
  // sample.master.json, distribution.current.json) are small, already-optimized
  // reads that routinely finish in well under 100ms -- confirmed directly via
  // instrumented tracing of a real sign-in, not assumed. Without a floor, the
  // checklist renders and dismisses correctly (per every test above) but is
  // gone before a user could ever read it, functionally reproducing "I don't
  // see what's loading" despite nothing being functionally broken.

  it("keeps the checklist visible for at least minVisibleMs even when every source finishes loading immediately", () => {
    renderOverlay(undefined, SESSION_ONE, 600);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      markBootSourceLoaded("population");
    });
    // Loaded, but the floor hasn't elapsed yet -- must still be showing.
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300); // short of the 600ms floor
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300); // now past the floor (600ms since shown)
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("dismisses immediately once minVisibleMs has already elapsed by the time loading finishes", () => {
    renderOverlay(undefined, SESSION_ONE, 600);
    act(() => {
      registerBootSources([
        { key: "population", labelAr: "بيانات السكان", labelEn: "population.final.json" },
      ]);
      markBootSourceLoading("population");
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(700); // past the floor while STILL loading
    });
    expect(screen.getByTestId("boot-splash-overlay")).toBeInTheDocument();

    // The floor has already been satisfied -- finishing now dismisses on the
    // very next macrotask (a 0ms setTimeout, not truly synchronous -- see the
    // top-of-file beforeEach comment), no additional real wait required.
    act(() => {
      markBootSourceLoaded("population");
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.queryByTestId("boot-splash-overlay")).not.toBeInTheDocument();
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
