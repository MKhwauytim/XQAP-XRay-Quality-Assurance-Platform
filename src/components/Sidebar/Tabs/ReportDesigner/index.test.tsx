/* @vitest-environment jsdom */
// B6 — ReportDesigner permission gating: a supervisor with view-only access to
// reports/report-designer (canMutate("report-designer.edit") === false, but tab *view*
// access true — the default permission matrix, TabGuard already enforces it one level up
// in Reports/index.tsx) must be able to browse and open saved designs and reach print,
// while create/save/delete stay blocked. A role with edit access must retain full
// functionality. Also covers the "آخر تعديل" date digit-locale fix (Latin, not
// Arabic-Indic digits).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { createEmptyDocument } from "../../../../data/reportDesigner/reportTypes";

// saveDesign is wrapped in vi.fn() (delegating to the real implementation) so
// the pending-autosave-flush-on-unmount tests below can assert on call counts
// without disturbing the real read/write behavior the other tests here rely on
// (e.g. seedDesign persisting a design that the list view then loads back).
vi.mock("../../../../data/reportDesigner/storage/reportDesignStorage", async () => {
  const actual = await vi.importActual<typeof import("../../../../data/reportDesigner/storage/reportDesignStorage")>(
    "../../../../data/reportDesigner/storage/reportDesignStorage"
  );
  return { ...actual, saveDesign: vi.fn(actual.saveDesign) };
});

import { saveDesign } from "../../../../data/reportDesigner/storage/reportDesignStorage";

// Mutable module-level flag so each test can pick view-only vs edit access (mirrors the
// pattern already used in Reports/index.test.tsx's globalMonthMock).
const permissionsMock = vi.hoisted(() => ({ state: { canEdit: false } }));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    role: "supervisor",
    username: "tester",
    // TabGuard (Reports/index.tsx, one level up, not owned by this bucket) already
    // enforces reports/report-designer view access before this component ever mounts —
    // simulate that "always reachable once we're here" contract.
    canAccessTab: () => true,
    can: () => true,
    canMutate: (featureId: string) => featureId === "report-designer.edit" && permissionsMock.state.canEdit,
    getMutationCapability: () => ({
      allowed: permissionsMock.state.canEdit,
      reason: permissionsMock.state.canEdit ? null : "page-not-editable",
    }),
    permissions: [],
    featurePermissions: [],
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: (globalThis as { __testDir?: DirectoryHandleLike }).__testDir ?? null }),
}));

// Task 2 perf fix: `ExecutiveRowsProvider` (shared KPI-tile data load) now wraps
// both the design-list view and EditorHost unconditionally, and it calls
// useGlobalMonth() eagerly regardless of whether any design on screen has a KPI
// element -- so this component tree requires GlobalMonthProvider context even
// though none of these fixtures use KPI elements. Mocked here the same way
// Reports/index.test.tsx mocks it, rather than pulling in the real provider.
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: { kind: "none" } }),
}));

import ReportDesigner from "./index";

afterEach(() => {
  cleanup();
  delete (globalThis as { __testDir?: DirectoryHandleLike }).__testDir;
  permissionsMock.state.canEdit = false;
  vi.mocked(saveDesign).mockClear();
  vi.useRealTimers();
});

function hasArabicIndicDigits(s: string): boolean {
  return /[٠-٩]/.test(s);
}

async function seedDesign(root: DirectoryHandleLike, name: string) {
  const doc = createEmptyDocument(name, "tester");
  const result = await saveDesign(root, doc);
  expect(result.ok).toBe(true);
  return doc;
}

describe("ReportDesigner — B6 view vs edit gating", () => {
  it("view-only (canEdit=false): open/thumbnail/print reachable, create/delete blocked", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير الإشراف");
    permissionsMock.state.canEdit = false;

    render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير الإشراف")).toBeInTheDocument();
    });

    // Create is blocked (report-designer.edit mutation).
    expect(screen.getByText("+ تقرير جديد").closest("button")).toBeDisabled();
    // Delete is blocked (report-designer.edit mutation).
    expect(screen.getByText("حذف").closest("button")).toBeDisabled();

    // Open is allowed — a read, gated on tab view access rather than canEditDesigns.
    const openBtn = screen.getByText("فتح").closest("button") as HTMLButtonElement;
    expect(openBtn).not.toBeDisabled();
    // The thumbnail itself (click-to-open affordance) must also be enabled.
    const thumb = screen.getByLabelText("فتح تقرير الإشراف");
    expect(thumb).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTitle("طباعة")).toBeInTheDocument();
    });
    // Print is reachable and enabled for a view-only user once inside the editor.
    expect(screen.getByTitle("طباعة")).not.toBeDisabled();
    // Save stays blocked for a view-only user.
    expect(screen.getByText("حفظ").closest("button")).toBeDisabled();

    // Cluster A: PagesBar's "+ صفحة" (add page) affordance previously rendered
    // enabled unconditionally regardless of canEdit, even though addPage() itself
    // already silently no-ops without edit access (TabView.tsx's `if (!canEdit)
    // return`). A view-only user must see it disabled, not clickable-and-inert.
    expect(screen.getByText("+ صفحة").closest("button")).toBeDisabled();
    // The per-page delete "×" affordance is not even rendered for a view-only user
    // (it previously rendered unconditionally and silently no-op'd on click).
    expect(screen.queryByLabelText("حذف صفحة 1")).not.toBeInTheDocument();
  });

  it("edit access (canEdit=true): create, delete, and save are all enabled", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير الإدارة");
    permissionsMock.state.canEdit = true;

    render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير الإدارة")).toBeInTheDocument();
    });

    expect(screen.getByText("+ تقرير جديد").closest("button")).not.toBeDisabled();
    expect(screen.getByText("حذف").closest("button")).not.toBeDisabled();

    fireEvent.click(screen.getByText("فتح").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText("حفظ").closest("button")).not.toBeDisabled();
    });

    // Cluster A counterpart: with edit access, PagesBar's add-page control is enabled
    // and the per-page delete affordance is rendered.
    expect(screen.getByText("+ صفحة").closest("button")).not.toBeDisabled();
    expect(screen.getByLabelText("حذف صفحة 1")).toBeInTheDocument();
  });

  it("formats the 'آخر تعديل' design-list date with Latin digits, not Arabic-Indic", async () => {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, "تقرير التواريخ");
    permissionsMock.state.canEdit = false;

    const { container } = render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText("تقرير التواريخ")).toBeInTheDocument();
    });

    const dateNode = container.querySelector(".rd-card-date");
    expect(dateNode).toBeTruthy();
    const text = dateNode?.textContent ?? "";
    expect(hasArabicIndicDigits(text)).toBe(false);
    expect(/[0-9]/.test(text)).toBe(true);
  });
});

// EditorHost's autosave debounce (800ms after the last `doc` change) used to be
// discarded — not flushed — on unmount: clicking "رجوع" (or any other unmount)
// less than 800ms after an edit silently dropped that edit. Covered here via the
// full ReportDesigner tree (EditorHost has no standalone export) since onBack
// simply stops rendering EditorHost, which is a real unmount.
describe("EditorHost — pending autosave flush on unmount", () => {
  async function openEditorWithNoPendingTimer(name: string) {
    const root = createMemoryDirectory("root");
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    await seedDesign(root, name);
    permissionsMock.state.canEdit = true;

    const view = render(<ReportDesigner />);

    await waitFor(() => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("فتح").closest("button") as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByTitle("طباعة")).toBeInTheDocument();
    });

    // Mounting EditorHost itself schedules an autosave debounce for the just-
    // loaded (unmodified) doc via the pre-existing `[doc]`-scoped effect. Flush
    // it explicitly via the manual Save button (still under real timers, so
    // this resolves quickly) so no real `setTimeout` is left pending once the
    // test switches to fake timers below -- a real, already-scheduled timer
    // would not be affected by vi.useFakeTimers() and could fire later,
    // outside the test's control.
    fireEvent.click(screen.getByText("حفظ").closest("button") as HTMLButtonElement);
    await waitFor(() => {
      expect(saveDesign).toHaveBeenCalled();
    });
    vi.mocked(saveDesign).mockClear();

    return view;
  }

  it("flushes a pending autosave on unmount instead of discarding it", async () => {
    const { unmount } = await openEditorWithNoPendingTimer("تقرير قيد التحرير");

    vi.useFakeTimers();

    // Add a text element -- mutates `doc`, scheduling a fresh 800ms debounce
    // (as a fake timer, since it's scheduled after vi.useFakeTimers() above).
    fireEvent.click(screen.getByTitle("نص"));

    // Unmount well before the 800ms debounce would have fired.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(saveDesign).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    // The pending edit must have been flushed on unmount, not discarded.
    expect(saveDesign).toHaveBeenCalledTimes(1);
  });

  it("does not fire a redundant second save on unmount once the debounce has already fired", async () => {
    const { unmount } = await openEditorWithNoPendingTimer("تقرير آخر بلا حفظ مكرر");

    vi.useFakeTimers();

    fireEvent.click(screen.getByTitle("نص"));

    // Let the debounce fire naturally (saveTimerRef.current is set back to
    // null by the timer callback itself once it runs).
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(saveDesign).toHaveBeenCalledTimes(1);

    // The unmount-flush effect's cleanup must see saveTimerRef.current === null
    // here and skip firing again.
    act(() => {
      unmount();
    });
    expect(saveDesign).toHaveBeenCalledTimes(1);
  });
});
