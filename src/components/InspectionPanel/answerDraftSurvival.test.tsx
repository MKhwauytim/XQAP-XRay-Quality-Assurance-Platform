/* @vitest-environment jsdom */
// Typed answers must survive a save that did not reach disk.
//
// Employees reported roughly one submission in ten hanging for about a minute
// and then failing, and having to "fill the information and study it again".
// The failure itself is share contention. Losing the work on top of it was the
// app's: `InspectionPanel` seeds its answers once at mount and holds them in
// React state, so anything that remounts the panel after a failed submit —
// moving to another sample and back, the tab-mount LRU, or the page reload an
// impatient person does after a minute-long hang — took the work with it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import InspectionPanel from "./index";
import { answerDraftKey, clearAnswerDraft, loadAnswerDraft } from "../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../data/answers/answerTypes";
import type { TemplateSchema } from "../../data/templates/templateTypes";

const DRAFT_KEY = answerDraftKey("5-may-2026", "IMG-001", "emp1");

const template: TemplateSchema = {
  templateId: "tpl-1",
  templateName: "نموذج الفحص",
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "admin",
  fields: [
    { fieldId: "notes", label: "ملاحظات", type: "text", required: false, options: [] },
  ],
};

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

function renderPanel(options?: { savedAnswer?: ItemAnswer | null; draftKey?: string }) {
  return render(
    <InspectionPanel
      entry={makeEntry()}
      template={template}
      savedAnswer={options?.savedAnswer ?? null}
      readonly={false}
      onClose={() => {}}
      onSave={async () => {}}
      draftKey={options?.draftKey}
    />
  );
}

function typeNotes(text: string): void {
  fireEvent.change(screen.getByLabelText(/ملاحظات/), { target: { value: text } });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("in-progress answer survival", () => {
  it("restores what was typed after the panel is remounted", () => {
    renderPanel({ draftKey: DRAFT_KEY });
    typeNotes("فحص جزئي — لم يُحفظ بعد");
    cleanup();

    // The employee comes back to the sample (or reloads the page after the hang).
    renderPanel({ draftKey: DRAFT_KEY });
    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("فحص جزئي — لم يُحفظ بعد");
  });

  it("prefers the unsaved draft over the answer already on disk", () => {
    const saved: ItemAnswer = {
      xrayImageId: "IMG-001",
      answeredBy: "emp1",
      answers: [{ fieldId: "notes", value: "النسخة المحفوظة" }],
      status: "draft",
      submittedAt: null,
      templateId: "tpl-1",
      templateVersion: 1,
      lastSavedAt: "2026-05-02T00:00:00.000Z",
    };
    renderPanel({ savedAnswer: saved, draftKey: DRAFT_KEY });
    typeNotes("تعديل لاحق لم يُحفظ");
    cleanup();

    // The draft only exists because a submit did NOT reach disk, so it is by
    // construction the newer of the two and the work that would be lost.
    renderPanel({ savedAnswer: saved, draftKey: DRAFT_KEY });
    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("تعديل لاحق لم يُحفظ");
  });

  it("falls back to the saved answer once the draft is cleared", () => {
    const saved: ItemAnswer = {
      xrayImageId: "IMG-001",
      answeredBy: "emp1",
      answers: [{ fieldId: "notes", value: "النسخة المحفوظة" }],
      status: "draft",
      submittedAt: null,
      templateId: "tpl-1",
      templateVersion: 1,
      lastSavedAt: "2026-05-02T00:00:00.000Z",
    };
    renderPanel({ savedAnswer: saved, draftKey: DRAFT_KEY });
    typeNotes("تعديل");
    cleanup();
    // What XrayReferrals does after a save that genuinely landed.
    clearAnswerDraft(DRAFT_KEY);

    renderPanel({ savedAnswer: saved, draftKey: DRAFT_KEY });
    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("النسخة المحفوظة");
  });

  it("keeps the old purely-in-memory behaviour when no draftKey is given", () => {
    renderPanel();
    typeNotes("لن يُحفظ محلياً");
    cleanup();

    expect(loadAnswerDraft(DRAFT_KEY)).toBeNull();
    renderPanel();
    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("");
  });
});
