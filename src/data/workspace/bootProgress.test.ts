/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  markBootSourceError,
  markBootSourceLoaded,
  markBootSourceLoading,
  registerBootSources,
  resetBootProgress,
  useBootProgress,
} from "./bootProgress";

afterEach(() => {
  resetBootProgress();
});

describe("bootProgress", () => {
  it("registers sources initialized as pending", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([
        { key: "population_summary", labelEn: "population.final.json", labelAr: "بيانات المجتمع المعالجة" },
        { key: "employee_samples", labelEn: "main.samples.json", labelAr: "عينات الموظفين" },
      ]);
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries.every((entry) => entry.status === "pending")).toBe(true);
    expect(result.current.allLoaded).toBe(false);
  });

  it("transitions a source through loading -> loaded and re-renders the hook", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([
        { key: "population_summary", labelEn: "population.final.json", labelAr: "بيانات المجتمع المعالجة" },
      ]);
    });

    act(() => {
      markBootSourceLoading("population_summary");
    });
    expect(result.current.entries[0].status).toBe("loading");

    act(() => {
      markBootSourceLoaded("population_summary");
    });
    expect(result.current.entries[0].status).toBe("loaded");
    expect(result.current.entries[0].error).toBeUndefined();
  });

  it("markBootSourceError sets status to error and records the message", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([{ key: "risk_raw", labelEn: "risk.raw.json", labelAr: "بيانات المخاطر الخام" }]);
    });

    act(() => {
      markBootSourceError("risk_raw", "تعذر القراءة");
    });

    expect(result.current.entries[0].status).toBe("error");
    expect(result.current.entries[0].error).toBe("تعذر القراءة");
  });

  it("clears a stale error when the source later starts loading again", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([{ key: "risk_raw", labelEn: "risk.raw.json", labelAr: "بيانات المخاطر الخام" }]);
      markBootSourceError("risk_raw", "تعذر القراءة");
    });
    expect(result.current.entries[0].error).toBe("تعذر القراءة");

    act(() => {
      markBootSourceLoading("risk_raw");
    });
    expect(result.current.entries[0].status).toBe("loading");
    expect(result.current.entries[0].error).toBeUndefined();
  });

  it("allLoaded is false while any registered entry is still pending or loading", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([
        { key: "a", labelEn: "a.json", labelAr: "أ" },
        { key: "b", labelEn: "b.json", labelAr: "ب" },
      ]);
    });

    act(() => {
      markBootSourceLoaded("a");
    });
    expect(result.current.allLoaded).toBe(false);

    act(() => {
      markBootSourceLoading("b");
    });
    expect(result.current.allLoaded).toBe(false);
  });

  it("allLoaded becomes true once every registered entry reaches loaded", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([
        { key: "a", labelEn: "a.json", labelAr: "أ" },
        { key: "b", labelEn: "b.json", labelAr: "ب" },
      ]);
    });

    act(() => {
      markBootSourceLoaded("a");
      markBootSourceLoaded("b");
    });

    expect(result.current.allLoaded).toBe(true);
  });

  it("an error entry does NOT block allLoaded -- a failed source must not hang the checklist forever", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([
        { key: "a", labelEn: "a.json", labelAr: "أ" },
        { key: "b", labelEn: "b.json", labelAr: "ب" },
      ]);
    });

    act(() => {
      markBootSourceLoaded("a");
      markBootSourceError("b", "فشل التحميل");
    });

    expect(result.current.allLoaded).toBe(true);
    expect(result.current.entries.find((entry) => entry.key === "b")?.status).toBe("error");
  });

  it("allLoaded is vacuously true when nothing has been registered", () => {
    const { result } = renderHook(() => useBootProgress());
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.allLoaded).toBe(true);
  });

  it("resetBootProgress clears all entries back to empty", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([{ key: "a", labelEn: "a.json", labelAr: "أ" }]);
      markBootSourceLoaded("a");
    });
    expect(result.current.entries).toHaveLength(1);

    act(() => {
      resetBootProgress();
    });
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.allLoaded).toBe(true);
  });

  it("marking a status on a key that was never registered is a defensive no-op", () => {
    const { result } = renderHook(() => useBootProgress());

    expect(() => {
      act(() => {
        markBootSourceLoading("never_registered");
        markBootSourceLoaded("never_registered");
        markBootSourceError("never_registered", "x");
      });
    }).not.toThrow();

    expect(result.current.entries).toHaveLength(0);
  });

  it("re-registering an already-registered key resets its status back to pending", () => {
    const { result } = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([{ key: "a", labelEn: "a.json", labelAr: "أ" }]);
      markBootSourceLoaded("a");
    });
    expect(result.current.entries[0].status).toBe("loaded");

    act(() => {
      registerBootSources([{ key: "a", labelEn: "a.json", labelAr: "أ" }]);
    });
    expect(result.current.entries[0].status).toBe("pending");
  });

  it("a second subscribed hook instance sees the same updates (shared module-level store)", () => {
    const first = renderHook(() => useBootProgress());
    const second = renderHook(() => useBootProgress());

    act(() => {
      registerBootSources([{ key: "a", labelEn: "a.json", labelAr: "أ" }]);
      markBootSourceLoaded("a");
    });

    expect(first.result.current.entries[0].status).toBe("loaded");
    expect(second.result.current.entries[0].status).toBe("loaded");
  });
});
