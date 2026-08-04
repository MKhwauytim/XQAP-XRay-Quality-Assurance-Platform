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

function renderOverlay(timeoutMs?: number) {
  return render(
    <BootSplashOverlay timeoutMs={timeoutMs}>
      <div data-testid="app-content">التطبيق يعمل</div>
    </BootSplashOverlay>,
  );
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
});
