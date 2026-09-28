/* @vitest-environment jsdom */
// A1 fix round 2 (task 18 follow-up): the draft-vs-saved-answer seeding used
// to load a stored draft (canonical OR legacy key) regardless of the row's
// status, so a leftover draft from before a failed/interrupted save — or from
// before the dual-clear fix (94eaf79) — could win over a SUBMITTED answer and
// render as the "current" value, both in the read-only view and as the seed
// for the edit form after a reopen. A submitted answer (or a completed entry)
// is the record of truth: no draft may load over it, and any leftover draft
// under either key must be cleared so it can never resurface.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import InspectionPanel from "./index";
import {
  answerDraftKey,
  loadAnswerDraft,
  loadAnswerDraftWithLegacyFallback,
  saveAnswerDraft,
} from "../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../data/answers/answerTypes";
import type { TemplateSchema } from "../../data/templates/templateTypes";

const CANONICAL_KEY = answerDraftKey("5-may-2026", "IMG-001", "emp1");
const LEGACY_KEY = "xray_answer_draft_v1:5-may-2026::IMG-001::emp1::legacy";

const template: TemplateSchema = {
  templateId: "tpl-1",
  templateName: "نموذج الفحص",
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "admin",
  fields: [{ fieldId: "notes", label: "ملاحظات", type: "text", required: false, options: [] }],
};

function makeEntry(status: DistributionEntry["status"] = "pending"): DistributionEntry {
  return {
    xrayImageId: "IMG-001",
    assignedTo: "emp1",
    status,
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

function submittedAnswer(value: string): ItemAnswer {
  return {
    xrayImageId: "IMG-001",
    answeredBy: "emp1",
    answers: [{ fieldId: "notes", value }],
    status: "submitted",
    submittedAt: "2026-08-02T00:00:00.000Z",
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: "2026-08-02T00:00:00.000Z",
  };
}

function draftAnswer(value: string): ItemAnswer {
  return {
    xrayImageId: "IMG-001",
    answeredBy: "emp1",
    answers: [{ fieldId: "notes", value }],
    status: "draft",
    submittedAt: null,
    templateId: "tpl-1",
    templateVersion: 1,
    lastSavedAt: "2026-08-02T00:00:00.000Z",
  };
}

function renderPanel(options: {
  entry?: DistributionEntry;
  savedAnswer?: ItemAnswer | null;
  legacy?: boolean;
}) {
  return render(
    <InspectionPanel
      entry={options.entry ?? makeEntry()}
      template={template}
      savedAnswer={options.savedAnswer ?? null}
      readonly={false}
      onClose={() => {}}
      onSave={async () => {}}
      draftKey={CANONICAL_KEY}
      legacyDraftKey={options.legacy ? LEGACY_KEY : null}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("a submitted answer is never shadowed by a leftover draft", () => {
  it("renders the saved values, not a legacy draft, and clears both keys", () => {
    saveAnswerDraft(LEGACY_KEY, { notes: "مسودة قديمة قبل الترحيل" });

    renderPanel({ savedAnswer: submittedAnswer("النسخة المعتمدة"), legacy: true });

    expect(screen.getByText("النسخة المعتمدة")).toBeInTheDocument();
    expect(screen.queryByText("مسودة قديمة قبل الترحيل")).not.toBeInTheDocument();
    expect(loadAnswerDraft(CANONICAL_KEY)).toBeNull();
    expect(loadAnswerDraft(LEGACY_KEY)).toBeNull();
  });

  it("renders the saved values, not a canonical-key draft, and clears both keys", () => {
    saveAnswerDraft(CANONICAL_KEY, { notes: "مسودة لم تُحذف" });

    renderPanel({ savedAnswer: submittedAnswer("النسخة المعتمدة") });

    expect(screen.getByText("النسخة المعتمدة")).toBeInTheDocument();
    expect(screen.queryByText("مسودة لم تُحذف")).not.toBeInTheDocument();
    expect(loadAnswerDraft(CANONICAL_KEY)).toBeNull();
  });

  it("also gates on a COMPLETED entry with no submitted answer status set", () => {
    saveAnswerDraft(CANONICAL_KEY, { notes: "مسودة قديمة" });

    renderPanel({ entry: makeEntry("completed"), savedAnswer: draftAnswer("النسخة المحفوظة") });

    expect(screen.getByText("النسخة المحفوظة")).toBeInTheDocument();
    expect(screen.queryByText("مسودة قديمة")).not.toBeInTheDocument();
    expect(loadAnswerDraft(CANONICAL_KEY)).toBeNull();
  });

  it("still restores a draft for an UNSUBMITTED row (no regression)", () => {
    saveAnswerDraft(CANONICAL_KEY, { notes: "تعديل لم يُحفظ بعد" });

    renderPanel({ savedAnswer: draftAnswer("النسخة المحفوظة") });

    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("تعديل لم يُحفظ بعد");
    // Not submitted -- the leftover draft is legitimate newer work and must survive.
    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, null)).toEqual({
      notes: "تعديل لم يُحفظ بعد",
    });
  });

  it("still restores a legacy-key draft for an UNSUBMITTED row (no regression)", () => {
    saveAnswerDraft(LEGACY_KEY, { notes: "من المفتاح القديم" });

    renderPanel({ savedAnswer: null, legacy: true });

    expect(screen.getByLabelText(/ملاحظات/)).toHaveValue("من المفتاح القديم");
  });

  it("clicking into an already-submitted row a second time does not re-throw or re-clear needlessly", () => {
    // Nothing stored under either key -- the effect's clear calls must be inert.
    expect(() => renderPanel({ savedAnswer: submittedAnswer("قيمة") })).not.toThrow();
    expect(screen.getByText("قيمة")).toBeInTheDocument();
  });
});
