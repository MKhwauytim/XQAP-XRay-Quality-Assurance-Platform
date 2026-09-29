/* @vitest-environment jsdom */
// Q3 (D7): the prior-month switching-rule advisory feeds ONE place — Phase 3
// of the Process sub-tab. It used to be re-read on every Population mutation
// (monthRefreshKey), from any sub-tab, although the prior month does not
// change when the current month's data does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { SamplingPlanPriorMonthAdvisory } from "../../../../data/sampling/samplingPlanStorage";

const loadMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../data/sampling/switchingRuleAdvisory", () => ({ loadPriorMonthAdvisory: loadMock }));

import {
  PRIOR_MONTH_ADVISORY_TTL_MS,
  __resetPriorMonthAdvisoryCacheForTests,
  usePriorMonthAdvisory,
} from "./usePriorMonthAdvisory";

const ADVISORY: SamplingPlanPriorMonthAdvisory = {
  priorMonthFolderName: "4-april-2026",
  priorMonthSuspicionRate: 0.2,
  inspectionRecommendation: null,
} as SamplingPlanPriorMonthAdvisory;

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  loadMock.mockReset();
  loadMock.mockResolvedValue(ADVISORY);
  __resetPriorMonthAdvisoryCacheForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePriorMonthAdvisory", () => {
  it("reads nothing while the sub-tab that needs it is not visible", async () => {
    const { result } = renderHook(() => usePriorMonthAdvisory(root, "5-may-2026", false));
    await Promise.resolve();
    expect(loadMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("reads once when it becomes visible, and not again on re-renders", async () => {
    const { result, rerender } = renderHook(
      ({ on }) => usePriorMonthAdvisory(root, "5-may-2026", on),
      { initialProps: { on: false } }
    );
    rerender({ on: true });
    await waitFor(() => expect(result.current).toEqual(ADVISORY));
    rerender({ on: true });
    rerender({ on: true });
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("hiding and re-showing within the interval does not re-read; after the interval it does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { result, rerender } = renderHook(
      ({ on }) => usePriorMonthAdvisory(root, "5-may-2026", on),
      { initialProps: { on: true } }
    );
    await vi.waitFor(() => expect(result.current).toEqual(ADVISORY));
    rerender({ on: false });
    rerender({ on: true });
    await vi.waitFor(() => expect(result.current).toEqual(ADVISORY));
    expect(loadMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + PRIOR_MONTH_ADVISORY_TTL_MS + 1000);
    rerender({ on: false });
    rerender({ on: true });
    await vi.waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
  });

  it("a different month reads its own advisory and never shows the previous month's", async () => {
    const { result, rerender } = renderHook(
      ({ month }) => usePriorMonthAdvisory(root, month, true),
      { initialProps: { month: "5-may-2026" } }
    );
    await waitFor(() => expect(result.current).toEqual(ADVISORY));
    let release: (v: SamplingPlanPriorMonthAdvisory) => void = () => {};
    loadMock.mockReturnValueOnce(new Promise<SamplingPlanPriorMonthAdvisory>((r) => { release = r; }));
    rerender({ month: "6-june-2026" });
    expect(result.current).toBeNull();
    release({ ...ADVISORY, priorMonthFolderName: "5-may-2026" });
    await waitFor(() => expect(result.current?.priorMonthFolderName).toBe("5-may-2026"));
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it("a failed read reports no advisory and is not cached", async () => {
    loadMock.mockRejectedValueOnce(new Error("share offline"));
    const { result, rerender } = renderHook(
      ({ on }) => usePriorMonthAdvisory(root, "5-may-2026", on),
      { initialProps: { on: true } }
    );
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
    rerender({ on: false });
    rerender({ on: true });
    await waitFor(() => expect(result.current).toEqual(ADVISORY));
    expect(loadMock).toHaveBeenCalledTimes(2);
  });
});
