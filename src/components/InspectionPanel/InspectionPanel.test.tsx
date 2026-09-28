/* @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import InspectionPanel from "./index";
import { DEFAULT_LABELS } from "../../data/labels/labelsStore";
import {
  __resetAnswerDraftHealthForTests,
  isAnswerDraftPersistFailing,
  loadAnswerDraft,
  saveAnswerDraft,
} from "../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { AnswerSaveOutcome, FieldAnswer, ItemAnswer } from "../../data/answers/answerTypes";
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

// ── Header sample navigation ────────────────────────────────────────────────

describe("InspectionPanel — previous/next sample controls", () => {
  const template = makeTemplate([field({ fieldId: "t", label: "نص", type: "text" })]);

  function renderWithNav(props: {
    onPrevSample?: () => void;
    onNextSample?: () => void;
    hasPrevSample?: boolean;
    hasNextSample?: boolean;
  }) {
    return render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {}}
        {...props}
      />
    );
  }

  it("renders no navigation control at all when the caller wires none", () => {
    // The panel must stay usable outside a queue — this is the pre-redesign
    // shape, and every existing call site that does not navigate keeps it.
    renderPanel(template);
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.ip_prev_sample_title })).toBeNull();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.ip_next_sample_title })).toBeNull();
  });

  it("calls back on click and disables whichever end of the set it is at", () => {
    const calls: string[] = [];
    renderWithNav({
      onPrevSample: () => calls.push("prev"),
      onNextSample: () => calls.push("next"),
      hasPrevSample: false,
      hasNextSample: true,
    });

    const prev = screen.getByRole("button", { name: DEFAULT_LABELS.ip_prev_sample_title });
    const next = screen.getByRole("button", { name: DEFAULT_LABELS.ip_next_sample_title });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(calls).toEqual(["next"]);

    // The disabled end is inert rather than merely unstyled — the panel never
    // re-points itself, so a click that got through would ask the caller to
    // navigate somewhere it has already said does not exist.
    fireEvent.click(prev);
    expect(calls).toEqual(["next"]);
  });
});

// ── Failed save does not discard the entered answer (B-XQIO032 part 1) ─────
//
// The reported bug (XQ-IO-032, intermittent write failures) raised a real
// question: does a failed save clear what the employee just typed? It does
// not — `ans` is plain `useState` seeded once at mount, `onSave` failing
// (rejecting, exactly like every real write-path error here: `handleSave` in
// XrayReferrals.tsx always resolves normally and reports failure via
// `setStatusMsg`, but this panel must stay safe even against an `onSave` that
// rejects outright, since it is a generic prop) touches none of it, and the
// panel is keyed on `entry.xrayImageId` so nothing here remounts it. This
// suite pins that down directly, from the field's own value in the DOM.

describe("InspectionPanel — a failed save preserves the typed answer (B-XQIO032)", () => {
  const template = makeTemplate([
    field({ fieldId: "r1", label: "المنفذ", type: "text", required: true }),
  ]);

  it("keeps the typed value on screen and re-enables the submit button after onSave rejects", async () => {
    let calls = 0;
    const { container } = render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {
          calls += 1;
          throw new Error("XQ-IO-032");
        }}
      />
    );

    const input = container.querySelector<HTMLInputElement>("#ipf-r1")!;
    fireEvent.change(input, { target: { value: "جدة" } });
    expect(input.value).toBe("جدة");

    const submitBtn = screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });
    fireEvent.click(submitBtn);
    // submitStudy's `finally` resets `submitting` once the rejected promise
    // settles — await that microtask turn before asserting the button state.
    await screen.findByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });

    expect(calls).toBe(1);
    // The whole point: the typed value must still be exactly what was typed.
    expect(input.value).toBe("جدة");
    // Not stuck on "جاري الإرسال..." (submitting=false was restored), and not
    // disabled — the existing button IS the retry affordance.
    expect(submitBtn).not.toBeDisabled();
    // A clear, visible (Arabic, not the raw exception text) error message.
    expect(screen.getByText(DEFAULT_LABELS.ip_msg_save_failed_generic)).toBeInTheDocument();
  });

  it("retrying with the same button re-submits the same data the user already entered", async () => {
    const saved: Array<Array<{ fieldId: string; value: unknown }>> = [];
    let shouldFail = true;
    const { container } = render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async (ans) => {
          if (shouldFail) throw new Error("XQ-IO-032");
          saved.push(ans);
        }}
      />
    );

    const input = container.querySelector<HTMLInputElement>("#ipf-r1")!;
    fireEvent.change(input, { target: { value: "الدمام" } });

    const submitBtn = screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });
    fireEvent.click(submitBtn);
    await screen.findByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });
    expect(saved).toHaveLength(0);

    // Same click target, no retyping required — this IS the retry path.
    shouldFail = false;
    fireEvent.click(submitBtn);
    await screen.findByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });

    expect(saved).toEqual([[{ fieldId: "r1", value: "الدمام" }]]);
  });
});

// ── Multi-select option group ───────────────────────────────────────────────

describe("InspectionPanel — multiselect fields", () => {
  function renderCapturing(template: TemplateSchema) {
    const saved: FieldAnswer[][] = [];
    render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async (ans) => {
          saved.push(ans);
        }}
      />
    );
    return saved;
  }

  const natureField = field({
    fieldId: "nature",
    label: "طبيعة البضاعة",
    type: "multiselect",
    required: true,
    options: ["سوائل", "مركبات", "مساحيق"],
  });

  it("renders every option as an independent toggle, not a single-choice control", () => {
    const { container } = renderPanel(makeTemplate([natureField]));

    const group = screen.getByRole("group", { name: "طبيعة البضاعة" });
    for (const option of ["سوائل", "مركبات", "مساحيق"]) {
      expect(within(group).getByRole("button", { name: option })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }
    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(within(group).getByRole("button", { name: "سوائل" }));
    fireEvent.click(within(group).getByRole("button", { name: "مساحيق" }));

    // The second pick must not clear the first — that is the whole difference
    // between this control and the dropdown it would otherwise have been.
    expect(within(group).getByRole("button", { name: "سوائل" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "مساحيق" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "مركبات" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles a selected option back off", () => {
    renderPanel(makeTemplate([natureField]));
    const group = screen.getByRole("group", { name: "طبيعة البضاعة" });
    const liquids = within(group).getByRole("button", { name: "سوائل" });

    fireEvent.click(liquids);
    expect(liquids).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(liquids);
    expect(liquids).toHaveAttribute("aria-pressed", "false");
  });

  it("counts as unanswered until at least one option is picked, and blocks submit", () => {
    const saved = renderCapturing(makeTemplate([natureField]));

    expect(screen.getByText(progressText(0, 1))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));
    expect(screen.getByText(DEFAULT_LABELS.ip_msg_missing_required_submit)).toBeInTheDocument();
    expect(saved).toHaveLength(0);

    const group = screen.getByRole("group", { name: "طبيعة البضاعة" });
    fireEvent.click(within(group).getByRole("button", { name: "مركبات" }));
    expect(screen.getByText(progressText(1, 1))).toBeInTheDocument();
  });

  it("stores the selection in template order, whatever order it was clicked in", () => {
    const saved = renderCapturing(makeTemplate([natureField]));
    const group = screen.getByRole("group", { name: "طبيعة البضاعة" });

    // Clicked last-to-first on purpose.
    fireEvent.click(within(group).getByRole("button", { name: "مساحيق" }));
    fireEvent.click(within(group).getByRole("button", { name: "سوائل" }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual([{ fieldId: "nature", value: "سوائل | مساحيق" }]);
  });

  it("reveals a field conditioned on one option even when several are picked", () => {
    renderPanel(
      makeTemplate([
        natureField,
        field({
          fieldId: "vehicleDetail",
          label: "تفاصيل المركبة",
          type: "text",
          condition: { sourceFieldId: "nature", operator: "equals", value: "مركبات" },
        }),
      ])
    );

    expect(screen.queryByLabelText("تفاصيل المركبة")).toBeNull();

    const group = screen.getByRole("group", { name: "طبيعة البضاعة" });
    fireEvent.click(within(group).getByRole("button", { name: "سوائل" }));
    expect(screen.queryByLabelText("تفاصيل المركبة")).toBeNull();

    fireEvent.click(within(group).getByRole("button", { name: "مركبات" }));
    expect(screen.getByLabelText("تفاصيل المركبة")).toBeInTheDocument();
  });
});

describe("InspectionPanel — draft that cannot be kept (A1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetAnswerDraftHealthForTests();
  });

  it("warns that the typed answer will not survive a reload", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text" })]);
    const { container } = render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {}}
        draftKey="xray_answer_draft_v1:m::IMG-001::emp1"
      />
    );

    fireEvent.change(container.querySelector<HTMLInputElement>("#ipf-n1")!, { target: { value: "نص" } });

    expect(await screen.findByText(DEFAULT_LABELS.ip_msg_draft_not_persisted)).toBeInTheDocument();
  });

  it("does not warn on an already-submitted row", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    // Fail — and pick this up in the health flag — BEFORE mount, so the
    // panel's very first render already reflects a true flag (the
    // subscription's own update is an async queueMicrotask notification a
    // synchronous assertion right after mount would otherwise race).
    saveAnswerDraft("xray_answer_draft_v1:probe", { p: "x" });
    expect(isAnswerDraftPersistFailing()).toBe(true);

    const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text" })]);
    render(
      <InspectionPanel
        entry={{ ...makeEntry(), status: "completed" }}
        template={template}
        savedAnswer={{
          xrayImageId: "IMG-001",
          templateId: "tpl-1",
          templateVersion: 1,
          answers: [{ fieldId: "n1", value: "سابقاً" }],
          lastSavedAt: "2026-08-01T00:00:00.000Z",
          submittedAt: "2026-08-01T00:00:00.000Z",
          answeredBy: "emp1",
          status: "submitted",
        }}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {}}
        draftKey="xray_answer_draft_v1:m::IMG-001::emp1"
      />
    );

    expect(screen.queryByText(DEFAULT_LABELS.ip_msg_draft_not_persisted)).toBeNull();
  });
});

describe("InspectionPanel — legacy draft key fallback and migration (A1 fix round 1)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("seeds from the legacy key when the canonical key has nothing, then migrates on the next keystroke", () => {
    const CANONICAL = "xray_answer_draft_v1:adhoc-imp-1::ADHOC-1::emp1";
    const LEGACY = "xray_answer_draft_v1:5-may-2026::ADHOC-1::emp1";
    saveAnswerDraft(LEGACY, { n1: "من المفتاح القديم" });

    const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text" })]);
    const { container } = render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {}}
        draftKey={CANONICAL}
        legacyDraftKey={LEGACY}
      />
    );

    const input = container.querySelector<HTMLInputElement>("#ipf-n1")!;
    expect(input.value).toBe("من المفتاح القديم");

    fireEvent.change(input, { target: { value: "معدّل" } });

    expect(loadAnswerDraft(LEGACY)).toBeNull();
    expect(loadAnswerDraft(CANONICAL)).toEqual({ n1: "معدّل" });
  });
});

describe("InspectionPanel — inline save status (A1)", () => {
  const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text", required: false })]);

  function renderWith(onSave: () => Promise<AnswerSaveOutcome | void>) {
    return render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={onSave}
      />
    );
  }
  const submit = () => fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));

  it("shows saving, then saved, from a successful outcome", async () => {
    let resolve!: (outcome: AnswerSaveOutcome) => void;
    renderWith(() => new Promise<AnswerSaveOutcome>((done) => { resolve = done; }));
    submit();
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_saving)).toBeInTheDocument();
    await act(async () => { resolve({ ok: true }); });
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_saved)).toBeInTheDocument();
  });

  it("says the answer is not saved yet and will retry when it was queued", async () => {
    renderWith(async () => ({ ok: false, message: "تعذّر الحفظ (XQ-IO-038)", queuedForRetry: true, errorCode: "XQ-IO-038" }));
    submit();
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_queued_coded.replace("{code}", "XQ-IO-038"))).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();
  });

  it("shows the failure message with its code, and keeps submit as the retry", async () => {
    renderWith(async () => ({ ok: false, message: "تعذّر حفظ البيانات (XQ-IO-038)." }));
    submit();
    expect(
      await screen.findByText(
        DEFAULT_LABELS.ip_save_status_failed.replace("{message}", "تعذّر حفظ البيانات (XQ-IO-038).")
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn })).not.toBeDisabled();
  });

  const submittedAnswer = (lastSavedAt: string): ItemAnswer => ({
    xrayImageId: "IMG-001", templateId: "tpl-1", templateVersion: 1,
    answers: [{ fieldId: "n1", value: "x" }],
    lastSavedAt, submittedAt: lastSavedAt, answeredBy: "emp1", status: "submitted",
  });
  const panelProps = (over: Partial<React.ComponentProps<typeof InspectionPanel>>) => ({
    entry: makeEntry(), template, savedAnswer: null, readonly: false,
    onClose: () => {}, onSave: async () => {}, ...over,
  });

  it("turns a queued line into saved when the replayed answer arrives via savedAnswer", async () => {
    const queuedAt = "2026-08-02T10:00:00.000Z";
    const onSave = async () => ({ ok: false as const, message: "تعذّر (XQ-IO-038)", queuedForRetry: true, queuedSavedAt: queuedAt, errorCode: "XQ-IO-038" });
    const { rerender } = render(<InspectionPanel {...panelProps({ onSave })} />);
    submit();
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_queued_coded.replace("{code}", "XQ-IO-038"))).toBeInTheDocument();

    // An OLDER submitted answer must not count as the queued one landing.
    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: submittedAnswer("2026-08-02T09:00:00.000Z") })} />);
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();

    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: submittedAnswer(queuedAt) })} />);
    expect(screen.getByText(DEFAULT_LABELS.ip_save_status_saved)).toBeInTheDocument();
  });

  it("empties the line on reopen after a queued save was derived as saved", async () => {
    const queuedAt = "2026-08-02T10:00:00.000Z";
    const onSave = async () => ({ ok: false as const, message: "تعذّر (XQ-IO-038)", queuedForRetry: true, queuedSavedAt: queuedAt, errorCode: "XQ-IO-038" });
    const { rerender, container } = render(<InspectionPanel {...panelProps({ onSave })} />);
    submit();
    await screen.findByText(DEFAULT_LABELS.ip_save_status_queued_coded.replace("{code}", "XQ-IO-038"));
    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: submittedAnswer(queuedAt) })} />);
    expect(screen.getByText(DEFAULT_LABELS.ip_save_status_saved)).toBeInTheDocument();
    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: null })} />);
    expect(container.querySelector(".ip-save-status")?.textContent).toBe("");
  });

  it("clears a failed line when the employee edits a field again", async () => {
    renderWith(async () => ({ ok: false, message: "تعذّر الحفظ." }));
    submit();
    await screen.findByText(DEFAULT_LABELS.ip_save_status_failed.replace("{message}", "تعذّر الحفظ."));
    fireEvent.change(screen.getByLabelText("ملاحظة"), { target: { value: "تعديل" } });
    expect(screen.queryByText(/لم يُحفظ/)).toBeNull();
  });

  it("clears a saved line when the answer is reopened", async () => {
    const onSave = async () => ({ ok: true as const });
    const { rerender } = render(<InspectionPanel {...panelProps({ onSave })} />);
    submit();
    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: submittedAnswer("2026-08-02T10:00:00.000Z") })} />);
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_saved)).toBeInTheDocument();
    rerender(<InspectionPanel {...panelProps({ onSave, savedAnswer: null })} />);
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();
  });

  it("shows no status for a legacy onSave that resolves nothing", async () => {
    renderWith(async () => {});
    submit();
    await screen.findByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saving)).toBeNull();
  });
});
