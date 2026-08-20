/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RequestQueue from "./RequestQueue";
import type { CardRequest } from "./requestKind";
import type {
  ReferralRequest,
  ReopenRequest,
  ReplacementRequest,
} from "../../../../../../data/referral/referralTypes";

afterEach(() => cleanup());

const referral: ReferralRequest = {
  requestId: "ref-1",
  monthFolderName: "5-may-2026",
  fromEmployee: "alice",
  toEmployee: "bob",
  xrayImageIds: ["IMG-R1", "IMG-R2"],
  reason: "مراجعة ثانية",
  requestedAt: "2026-05-01T10:00:00.000Z",
  requestedBy: "alice",
  status: "pending",
};

const replacement: ReplacementRequest = {
  requestId: "rep-1",
  monthFolderName: "5-may-2026",
  employeeUsername: "carol",
  originalXrayImageId: "IMG-ORIG",
  replacementXrayImageId: "IMG-REPL",
  reason: "صورة غير واضحة",
  requestedAt: "2026-05-02T10:00:00.000Z",
  requestedBy: "carol",
  status: "pending",
};

const reopen: ReopenRequest = {
  requestId: "reo-1",
  monthFolderName: "5-may-2026",
  employeeUsername: "dave",
  xrayImageId: "IMG-REOPEN",
  reason: "خطأ في الإدخال",
  requestedAt: "2026-05-03T10:00:00.000Z",
  requestedBy: "dave",
  status: "pending",
};

const userDisplayMap: Record<string, string> = {
  alice: "أليس", bob: "بوب", carol: "كارول", dave: "ديفيد",
};

function renderQueue(requests: CardRequest[], overrides: Partial<Parameters<typeof RequestQueue>[0]> = {}) {
  const props = {
    requests,
    userDisplayMap,
    selectedId: null,
    onSelect: () => {},
    oldestFirst: true,
    selectable: () => true,
    checked: new Set<string>(),
    onToggleCheck: () => {},
    page: 1,
    onPageChange: () => {},
    ...overrides,
  };
  return render(<RequestQueue {...props} />);
}

describe("RequestQueue", () => {
  it("renders one kind badge per row, labelled per kind", () => {
    const { container } = renderQueue([referral, replacement, reopen]);
    const labels = Array.from(container.querySelectorAll(".ew-req-kind-badge")).map((b) => b.textContent);
    expect(labels).toEqual(["إحالة", "استبدال", "إعادة فتح"]);
  });

  it("renders rows in the order given — the parent owns the sort", () => {
    const { container } = renderQueue([reopen, referral, replacement]);
    const labels = Array.from(container.querySelectorAll(".ew-req-kind-badge")).map((b) => b.textContent);
    expect(labels).toEqual(["إعادة فتح", "إحالة", "استبدال"]);
  });

  it("titles each row by kind, using display names for the referral route", () => {
    renderQueue([referral, replacement, reopen]);
    expect(screen.getByText("أليس ← بوب")).toBeTruthy();
    expect(screen.getByText("استبدال IMG-ORIG بـ IMG-REPL")).toBeTruthy();
    expect(screen.getByText("إعادة فتح الحالة IMG-REOPEN")).toBeTruthy();
  });

  it("selects the row when the card is clicked", () => {
    const onSelect = vi.fn();
    const { container } = renderQueue([referral], { onSelect });
    fireEvent.click(container.querySelector(".ew-approval-qcard") as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(referral);
  });

  it("ticking the checkbox toggles selection without also re-selecting the row", () => {
    const onSelect = vi.fn();
    const onToggleCheck = vi.fn();
    renderQueue([referral], { onSelect, onToggleCheck });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleCheck).toHaveBeenCalledWith("ref-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("omits the checkbox on rows the reviewer cannot act on", () => {
    renderQueue([referral], { selectable: () => false });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("marks a decided row with its outcome and reviewer", () => {
    renderQueue([{ ...referral, status: "approved", reviewedBy: "bob" }]);
    expect(screen.getByText("مقبول — بوب")).toBeTruthy();
  });

  it("shows the empty state instead of a bare list when nothing matches", () => {
    renderQueue([]);
    expect(screen.getByText("لا توجد طلبات لهذا التصنيف")).toBeTruthy();
  });
});
