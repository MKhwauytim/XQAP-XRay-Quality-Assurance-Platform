// Dev-only synthetic demo month for the deck live preview (deck-preview.html).
// Deterministic (seeded LCG) so the preview is stable across reloads. Never
// imported by app code — only by src/dev/deckPreview.ts.

import type { PreparedPopulationRow } from "../data/population/populationTypes";
import type {
  PortAllocation,
  SampleMasterData,
  StageAllocation,
} from "../data/sampling/sampleTypes";
import { DEFAULT_EXEC_CONFIG } from "../data/reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../data/reporting/executiveReportTypes";
import type { EmployeeAnswerFile, FieldAnswer, ItemAnswer } from "../data/answers/answerTypes";
import type { TemplateSchema } from "../data/templates/templateTypes";

// Deterministic pseudo-random (LCG) — stable preview data on every reload.
let seed = 42;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

const LAND_PORTS: Array<[string, number]> = [
  ["منفذ البطحاء", 620],
  ["منفذ الحديثة", 480],
  ["منفذ سلوى", 300],
  ["منفذ جديدة عرعر", 210],
  ["منفذ الوديعة", 160],
  ["منفذ حالة عمار", 120],
  ["منفذ الخفجي", 90],
  ["منفذ الربع الخالي", 25],
];

const SEA_PORTS: Array<[string, number]> = [
  ["ميناء جدة الإسلامي", 540],
  ["ميناء الملك عبدالعزيز", 460],
  ["ميناء جازان", 220],
  ["ميناء ينبع التجاري", 140],
  ["ميناء ضباء", 60],
  ["ميناء رأس الخير", 35],
];

const STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
// RAW Excel aliases, exactly as real processed workspaces store them in
// row.stage (see DEFAULT_STAGE_MAPPINGS) — NOT the canonical Arabic labels.
// The fixture previously used canonical labels, which masked a real-data bug:
// deck2's stage-port cards grouped rows by raw stage but looked up by the
// canonical label, rendering empty tables against every real workspace.
const STAGE_RAW_ALIASES: Record<(typeof STAGE_KEYS)[number], string> = {
  first: "FIRST_STAGE",
  second: "SECOND_STAG",
  third: "THIRD_STAGE",
  fourth: "FORTH_STAGE",
};
// Canonical labels, used only where real data is also canonical (the
// draw-time StageAllocation records).
const STAGE_LABELS: Record<(typeof STAGE_KEYS)[number], string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};
// Risk-engine stage mix (roughly: most cases low stage, few at the top).
const STAGE_WEIGHTS = [0.45, 0.3, 0.18, 0.07];

function pickStage(): (typeof STAGE_KEYS)[number] {
  const r = rnd();
  let acc = 0;
  for (let i = 0; i < STAGE_KEYS.length; i++) {
    acc += STAGE_WEIGHTS[i];
    if (r < acc) return STAGE_KEYS[i];
  }
  return "first";
}

function makeRow(
  id: number,
  portName: string,
  portCode: string,
  isSea: boolean,
): PreparedPopulationRow {
  const suspicious1 = rnd() < 0.05;
  const suspicious2 = suspicious1 ? rnd() < 0.7 : rnd() < 0.02;
  return {
    stage: STAGE_RAW_ALIASES[pickStage()],
    xrayImageId: `XR-${String(id).padStart(5, "0")}`,
    xrayEntryDate: null,
    portCode,
    portType: isSea ? "منفذ بحري" : "منفذ بري",
    portName,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: suspicious1 ? "اشتباه" : "سليمة",
    xrayLevelTwoResult: suspicious2 ? "اشتباه" : "سليمة",
    movementType: isSea ? "بحري" : "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: `EMP-${1 + Math.floor(rnd() * 9)}`,
    levelTwoEmployee: `EMP-${10 + Math.floor(rnd() * 5)}`,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: rnd() < 0.4 ? "Certscan" : "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Matched",
    biMatched: true,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: id,
  };
}

/** Draw ~coverage% of each port's rows (at least 1) as the sample. */
function drawSample(rows: PreparedPopulationRow[], coverage = 0.075): SampleMasterData {
  const byPort = new Map<string, PreparedPopulationRow[]>();
  for (const r of rows) {
    const arr = byPort.get(r.portName ?? "؟") ?? [];
    arr.push(r);
    byPort.set(r.portName ?? "؟", arr);
  }

  const sampleRows: PreparedPopulationRow[] = [];
  const portAllocations: PortAllocation[] = [];
  for (const [portName, portRows] of byPort) {
    const quota = Math.max(1, Math.round(portRows.length * coverage));
    // Cheap deterministic shuffle-ish pick.
    const picked = [...portRows].sort(() => rnd() - 0.5).slice(0, quota);
    sampleRows.push(...picked);
    const cert = (arr: PreparedPopulationRow[]) =>
      arr.filter((r) => r.certScanStatus === "Certscan").length;
    portAllocations.push({
      portName,
      populationSize: portRows.length,
      certScanCount: cert(portRows),
      nonCertScanCount: portRows.length - cert(portRows),
      allocatedQuota: quota,
      certScanQuota: cert(picked),
      nonCertScanQuota: picked.length - cert(picked),
      actualCertScanDrawn: cert(picked),
      actualNonCertScanDrawn: picked.length - cert(picked),
      actualTotalDrawn: picked.length,
    });
  }

  const stageAllocations: StageAllocation[] = STAGE_KEYS.map((key) => {
    const label = STAGE_LABELS[key];
    // Rows carry the RAW alias; only the allocation record is canonical —
    // mirroring exactly what the real sampler produces.
    const rawAlias = STAGE_RAW_ALIASES[key];
    const pop = rows.filter((r) => r.stage === rawAlias);
    const drawn = sampleRows.filter((r) => r.stage === rawAlias);
    return {
      stageKey: key,
      stageLabel: label,
      populationSize: pop.length,
      targetQuota: drawn.length,
      actualDrawn: drawn.length,
      certScanDrawn: drawn.filter((r) => r.certScanStatus === "Certscan").length,
      nonCertScanDrawn: drawn.filter((r) => r.certScanStatus !== "Certscan").length,
    };
  });

  const certActual = sampleRows.filter((r) => r.certScanStatus === "Certscan").length;
  return {
    rngSeed: "deck-preview-fixture",
    totalRequested: sampleRows.length,
    totalActual: sampleRows.length,
    certScanRequested: certActual,
    nonCertScanRequested: sampleRows.length - certActual,
    certScanActual: certActual,
    nonCertScanActual: sampleRows.length - certActual,
    portAllocations,
    stageAllocations,
    drawnAt: "2026-05-31T10:00:00.000Z",
    drawnBy: "deck-preview",
    rows: sampleRows,
  };
}

// ── Section 2 fixture — image quality + accuracy answers ─────────────────────
// A minimal template whose field labels match `DEFAULT_EXEC_FIELD_MAPPINGS`
// (the real app's field-matching-by-label convention), plus submitted
// answers for most of the sampled rows, so the section-2 report pages
// (image quality / accuracy per port) have real data to render in preview
// instead of the all-"—" empty state.
const TEMPLATE_ID = "tpl-deck-preview";
const FIELD_HAS_IMAGE = "fld-has-image";
const FIELD_HAS_MARKING = "fld-has-marking";
const FIELD_QUALITY = "fld-quality";
const FIELD_RESULT = "fld-result";

function buildPreviewTemplate(): TemplateSchema {
  return {
    templateId: TEMPLATE_ID,
    templateName: "نموذج معاينة (تجريبي)",
    version: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    createdBy: "deck-preview",
    updatedAt: "2026-05-01T00:00:00.000Z",
    updatedBy: "deck-preview",
    fields: [
      { fieldId: FIELD_HAS_IMAGE, label: "هل يوجد صورة", type: "dropdown", required: true, options: ["نعم", "لا"] },
      { fieldId: FIELD_HAS_MARKING, label: "هل يوجد تحديد", type: "dropdown", required: false, options: ["نعم", "لا"] },
      {
        fieldId: FIELD_QUALITY,
        label: "مستوى جودة الصورة",
        type: "dropdown",
        required: false,
        options: ["عالي", "متوسط", "منخفض"],
      },
      { fieldId: FIELD_RESULT, label: "صحة النتيجة", type: "dropdown", required: false, options: ["سليمة", "اشتباه"] },
    ],
  };
}

function buildPreviewAnswers(sampleRows: PreparedPopulationRow[]): EmployeeAnswerFile[] {
  const items: ItemAnswer[] = [];
  for (const row of sampleRows) {
    if (rnd() > 0.92) continue; // ~8% still in progress (not yet submitted)

    const imageAvailable = rnd() < 0.92;
    const hasMarking = imageAvailable && rnd() < 0.85;
    const qRoll = rnd();
    const quality = qRoll < 0.55 ? "عالي" : qRoll < 0.9 ? "متوسط" : "منخفض";
    const actual: "سليمة" | "اشتباه" =
      row.xrayLevelOneResult === "اشتباه" || row.xrayLevelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
    const expertResult = rnd() < 0.92 ? actual : actual === "اشتباه" ? "سليمة" : "اشتباه";

    const answers: FieldAnswer[] = [{ fieldId: FIELD_HAS_IMAGE, value: imageAvailable ? "نعم" : "لا" }];
    if (imageAvailable) {
      answers.push({ fieldId: FIELD_HAS_MARKING, value: hasMarking ? "نعم" : "لا" });
      answers.push({ fieldId: FIELD_QUALITY, value: quality });
      answers.push({ fieldId: FIELD_RESULT, value: expertResult });
    }

    items.push({
      xrayImageId: row.xrayImageId,
      templateId: TEMPLATE_ID,
      templateVersion: 1,
      answers,
      lastSavedAt: "2026-05-31T12:00:00.000Z",
      submittedAt: "2026-05-31T12:00:00.000Z",
      answeredBy: "deck-preview-inspector",
      status: "submitted",
    });
  }
  return [{ username: "deck-preview-inspector", monthFolderName: "5-may-2026", items }];
}

/** The full synthetic ExecutiveReportInput for the live deck preview. */
export function buildPreviewInput(): ExecutiveReportInput {
  seed = 42; // reset so repeated calls produce identical data
  const rows: PreparedPopulationRow[] = [];
  let id = 1;
  for (const [name, count] of LAND_PORTS) {
    const code = `L${String(id).padStart(2, "0")}`;
    for (let i = 0; i < count; i++) rows.push(makeRow(id++, name, code, false));
  }
  for (const [name, count] of SEA_PORTS) {
    const code = `S${String(id).padStart(2, "0")}`;
    for (let i = 0; i < count; i++) rows.push(makeRow(id++, name, code, true));
  }
  const sample = drawSample(rows);
  return {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample,
    distribution: null,
    employeeFiles: buildPreviewAnswers(sample.rows),
    template: buildPreviewTemplate(),
    config: DEFAULT_EXEC_CONFIG,
  };
}
