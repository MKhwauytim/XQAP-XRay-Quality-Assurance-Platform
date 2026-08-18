/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import InspectionPanel from "./index";
import { DEFAULT_LABELS } from "../../data/labels/labelsStore";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { TemplateField, TemplateSchema } from "../../data/templates/templateTypes";

// `globals: false` in this repo, so RTL's auto-cleanup never registers itself.
afterEach(cleanup);

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Everything the panel renders comes off the template schema, so these tests
// drive the redesign purely through schema shape — which is exactly the
// contract the design handoff requires ("field set/labels/validation must still
// come from the active template schema"; the segmented control is a *rendering*
// choice over that schema, never a hard-coded field list).

function field(partial: Partial<TemplateField> & { fieldId: string }): TemplateField {
  return {
    label: partial.fieldId,
    type: "text",
    required: false,
    options: [],
    ...partial,
  };
}

function makeTemplate(fields: TemplateField[]): TemplateSchema {
  return {
    templateId: "tpl-1",
    templateName: "نموذج الفحص",
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "admin",
    fields,
  };
}

function makeEntry(): DistributionEntry {
  return {
    xrayImageId: "IMG-001",
    assignedTo: "emp1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-08-01T00:00:00.000Z",
    row: {
      stage: "1",
      portName: "ميناء جدة",
      xrayEntryDate: "2026-08-01",
      plateOrContainerNumber: "C-1",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
      certScanStatus: "Certscan",
      declarationNumber: "D-1",
      declarationDate: "2026-08-01",
      chassisNumber: null,
      movementType: null,
      portCode: null,
      portType: null,
      targetedByRiskEngine: null,
      riskMessage: null,
      biEnrichmentStatus: "BI Not Provided",
      reportNumber: null,
    },
  };
}

function renderPanel(template: TemplateSchema) {
  return render(
    <InspectionPanel
      entry={makeEntry()}
      template={template}
      savedAnswer={null}
      readonly={false}
      onClose={() => {}}
      onSave={async () => {}}
    />
  );
}

function progressText(filled: number, total: number): string {
  return DEFAULT_LABELS.ip_required_progress
    .replace("{filled}", String(filled))
    .replace("{total}", String(total));
}

// ── Segmented verdict control ───────────────────────────────────────────────

describe("InspectionPanel — segmented verdict controls", () => {
  it("renders a 2-option dropdown as a segmented button group, not a <select>", () => {
    const { container } = renderPanel(
      makeTemplate([
        field({ fieldId: "verdict", label: "النتيجة", type: "dropdown", options: ["سليمة", "اشتباه"] }),
      ])
    );

    const group = screen.getByRole("group", { name: "النتيجة" });
    expect(within(group).getByRole("button", { name: "سليمة" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "اشتباه" })).toBeInTheDocument();
    expect(container.querySelector("select")).toBeNull();
  });

  it("renders a 3-option dropdown as a segmented button group", () => {
    const { container } = renderPanel(
      makeTemplate([
        field({
          fieldId: "verdict3",
          label: "القرار",
          type: "dropdown",
          options: ["موافق", "مرفوض", "معلّق"],
        }),
      ])
    );

    const group = screen.getByRole("group", { name: "القرار" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(container.querySelector("select")).toBeNull();
  });

  it("keeps the <select> for a dropdown with 4 or more options", () => {
    const { container } = renderPanel(
      makeTemplate([
        field({
          fieldId: "verdict4",
          label: "التصنيف",
          type: "dropdown",
          options: ["أ", "ب", "ج", "د"],
        }),
      ])
    );

    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    // placeholder + 4 options
    expect(select!.querySelectorAll("option")).toHaveLength(5);
    expect(screen.queryByRole("group", { name: "التصنيف" })).not.toBeInTheDocument();
  });

  it("marks the clicked segment as pressed and stores the option's own value", () => {
    renderPanel(
      makeTemplate([
        field({
          fieldId: "verdict",
          label: "النتيجة",
          type: "dropdown",
          required: true,
          options: ["سليمة", "اشتباه"],
        }),
      ])
    );

    const clean = screen.getByRole("button", { name: "سليمة" });
    const suspect = screen.getByRole("button", { name: "اشتباه" });
    expect(clean).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(suspect);
    expect(suspect).toHaveAttribute("aria-pressed", "true");
    expect(clean).toHaveAttribute("aria-pressed", "false");
    // The required field now counts as filled — proof the segment wrote the
    // same value shape the <select> used to write.
    expect(screen.getByText(progressText(1, 1))).toBeInTheDocument();
  });

  it("leaves every non-dropdown field type on its existing control", () => {
    const { container } = renderPanel(
      makeTemplate([
        field({ fieldId: "t", label: "نص", type: "text" }),
        field({ fieldId: "ta", label: "ملاحظات", type: "textarea" }),
        field({ fieldId: "n", label: "عدد", type: "number" }),
        field({ fieldId: "d", label: "تاريخ", type: "date" }),
        field({ fieldId: "c", label: "تأكيد", type: "checkbox" }),
        field({ fieldId: "cb", label: "بحث", type: "combobox", options: ["أ", "ب"] }),
        field({ fieldId: "e", label: "فاصل", type: "empty" }),
      ])
    );

    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(container.querySelector('input[type="text"]#ipf-t')).not.toBeNull();
    expect(container.querySelector("textarea#ipf-ta")).not.toBeNull();
    expect(container.querySelector('input[type="number"]#ipf-n')).not.toBeNull();
    expect(container.querySelector('input[type="date"]#ipf-d')).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]#ipf-c')).not.toBeNull();
    // combobox stays an <input list=…> + <datalist>, whatever its option count
    expect(container.querySelector("input#ipf-cb[list]")).not.toBeNull();
    expect(container.querySelector("datalist#ipf-cb-list")).not.toBeNull();
  });
});

// ── Required-field progress ─────────────────────────────────────────────────

describe("InspectionPanel — required-field progress", () => {
  const template = makeTemplate([
    field({ fieldId: "r1", label: "المنفذ", type: "text", required: true }),
    field({ fieldId: "r2", label: "النتيجة", type: "dropdown", required: true, options: ["سليمة", "اشتباه"] }),
    field({ fieldId: "r3", label: "العدد", type: "number", required: true }),
    field({ fieldId: "r4", label: "تأكيد الإجراء", type: "checkbox", required: true }),
    field({ fieldId: "r5", label: "الملاحظات", type: "textarea", required: true }),
    // Not required — must never be counted.
    field({ fieldId: "o1", label: "اختياري", type: "text" }),
  ]);

  it("counts only required fields and starts at zero", () => {
    renderPanel(template);
    expect(screen.getByText(progressText(0, 5))).toBeInTheDocument();
  });

  it("recounts as fields fill, across every control type", () => {
    const { container } = renderPanel(template);

    fireEvent.change(container.querySelector("#ipf-r1")!, { target: { value: "جدة" } });
    expect(screen.getByText(progressText(1, 5))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "سليمة" }));
    expect(screen.getByText(progressText(2, 5))).toBeInTheDocument();

    fireEvent.change(container.querySelector("#ipf-r3")!, { target: { value: "7" } });
    fireEvent.click(container.querySelector("#ipf-r4")!);
    fireEvent.change(container.querySelector("#ipf-r5")!, { target: { value: "لا شيء" } });
    expect(screen.getByText(progressText(5, 5))).toBeInTheDocument();

    // Filling the optional field moves nothing.
    fireEvent.change(container.querySelector("#ipf-o1")!, { target: { value: "x" } });
    expect(screen.getByText(progressText(5, 5))).toBeInTheDocument();
  });

  it("does not count a required field that is whitespace-only", () => {
    const { container } = renderPanel(template);
    fireEvent.change(container.querySelector("#ipf-r1")!, { target: { value: "   " } });
    expect(screen.getByText(progressText(0, 5))).toBeInTheDocument();
  });

  it("renders no progress bar when the template has no required fields", () => {
    renderPanel(makeTemplate([field({ fieldId: "o", label: "اختياري", type: "text" })]));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

// ── Footer (owner request 2026-08-18: no blocking-hint banner) ──────────────

describe("InspectionPanel — footer", () => {
  const template = makeTemplate([
    field({ fieldId: "r1", label: "المنفذ", type: "text", required: true }),
    field({ fieldId: "r2", label: "النتيجة", type: "dropdown", required: true, options: ["سليمة", "اشتباه"] }),
    field({ fieldId: "o1", label: "اختياري", type: "text" }),
  ]);

  it("renders no missing-required-fields banner even while required fields are empty", () => {
    renderPanel(template);
    // The header progress bar still reports 0/2; the removed banner must not
    // come back as a role=status element in the footer.
    expect(document.querySelector(".ip-blocking-hint")).toBeNull();
  });
});
