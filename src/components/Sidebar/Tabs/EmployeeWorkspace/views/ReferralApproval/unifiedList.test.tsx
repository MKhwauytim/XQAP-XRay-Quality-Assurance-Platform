/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import RequestList from "./RequestList";
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

function renderList(requests: CardRequest[], bulkEnabled = false) {
  return render(
    <RequestList
      requests={requests}
      bulkEnabled={bulkEnabled}
      userDisplayMap={userDisplayMap}
      sampleDetails={{}}
      canReview={() => true}
      onApprove={() => {}}
      onDeny={() => {}}
      onBulk={async () => []}
    />
  );
}

describe("unified approval list — all three request kinds", () => {
  it("renders one kind badge per row with the correct label for each kind", () => {
    const { container } = renderList([referral, replacement, reopen]);
    const badges = Array.from(container.querySelectorAll(".ew-req-kind-badge"));
    const labels = badges.map((b) => b.textContent);
    expect(labels).toContain("إحالة");
    expect(labels).toContain("استبدال");
    expect(labels).toContain("إعادة فتح");
    expect(badges).toHaveLength(3);
  });

  it("sorts the merged list chronologically (newest first when not in bulk mode)", () => {
    const { container } = renderList([referral, replacement, reopen], false);
    const badges = Array.from(container.querySelectorAll(".ew-req-kind-badge")).map((b) => b.textContent);
    // requestedAt: reopen (05-03) > replacement (05-02) > referral (05-01)
    expect(badges).toEqual(["إعادة فتح", "استبدال", "إحالة"]);
  });

  it("sorts oldest-first in bulk (pending) mode", () => {
    const { container } = renderList([reopen, referral, replacement], true);
    const badges = Array.from(container.querySelectorAll(".ew-req-kind-badge")).map((b) => b.textContent);
    expect(badges).toEqual(["إحالة", "استبدال", "إعادة فتح"]);
  });

  it("shows kind-specific meta so rows are easy to distinguish", () => {
    renderList([referral, replacement, reopen]);
    // Referral: from ← to (display names)
    expect(screen.getByText("أليس")).toBeTruthy();
    expect(screen.getByText("بوب")).toBeTruthy();
    // Replacement: original → replacement ids
    expect(screen.getByText("IMG-ORIG")).toBeTruthy();
    expect(screen.getByText("IMG-REPL")).toBeTruthy();
    // Reopen: employee + the single case id
    expect(screen.getByText("ديفيد")).toBeTruthy();
    expect(screen.getByText("IMG-REOPEN")).toBeTruthy();
  });

  it("renders approve/deny actions for pending rows the reviewer can review", () => {
    renderList([reopen]);
    const cards = document.querySelectorAll(".ew-referral-card");
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(within(card).getByText("موافقة")).toBeTruthy();
    expect(within(card).getByText("رفض")).toBeTruthy();
  });
});

describe("bulk confirm dialog — internal scroll", () => {
  it("scrolls the selected-request list inside the modal, keeping the action row reachable", () => {
    // Regression: the selected-request list is unbounded while
    // `.ew-replace-modal` is a bounded flex column with `overflow: hidden`, so
    // a large bulk selection clipped the list and pushed the confirm/cancel row
    // out of the panel.
    renderList([referral, replacement, reopen], true);

    for (const checkbox of screen.getAllByRole("checkbox", { name: "تحديد الطلب" })) {
      fireEvent.click(checkbox);
    }
    fireEvent.click(screen.getByRole("button", { name: "موافقة على المحدد" }));

    const dialog = screen.getByRole("dialog");
    const list = within(dialog).getByRole("list");
    const scroller = list.parentElement as HTMLElement;
    expect(scroller.style.overflowY).toBe("auto");
    expect(scroller.style.minHeight).toBe("0px");

    // The confirm/cancel row must live outside the scrolling body.
    const confirm = within(dialog).getByRole("button", { name: "تأكيد الموافقة" });
    expect(scroller.contains(confirm)).toBe(false);
  });
});
