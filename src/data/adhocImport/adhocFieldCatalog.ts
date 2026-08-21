/**
 * The ad-hoc import module's OWN field catalog.
 *
 * The keys, Arabic labels and seed aliases below are a deliberate LITERAL COPY
 * of `DEFAULT_SYSTEM_FIELDS` / `DEFAULT_MAPPING_TEMPLATE.columnMappings` from
 * `src/data/population/populationConfig.ts` — not an import, and not a read of
 * the workspace's live `config.json`. That is the G8 defect this rework
 * removes: the v1 path called `loadActiveColumnMappings()`, so an admin editing
 * the Population mapping screen retroactively changed how an ALREADY-SAVED
 * ad-hoc import parsed its rows. A copy drifts, visibly, in a diff; a live read
 * rewrites history silently.
 *
 * `key` matches the corresponding `PreparedPopulationRow` property name
 * wherever one exists, because a later step projects a mapped row onto that
 * type and a renamed key would land the value nowhere.
 *
 * Required fields: `xrayImageId`, `xrayLevelOneResult`, `xrayLevelTwoResult`.
 *
 * The Population catalog also marks `stage` required and v1 inherited that,
 * which made a perfectly legitimate `kind: "sample"` import (a bare list of
 * images to be reviewed) fail every row over a field the file has no reason to
 * carry. `stage` is therefore an ordinary optional field here.
 *
 * `xrayLevelOneResult` and `xrayLevelTwoResult` stay required, and the
 * distinction from `stage` is deliberate: both are
 * typed `"سليمة" | "اشتباه"` on `PreparedPopulationRow` with no representable
 * "unknown", so a row that reaches projection without them has to be given a
 * value — and any value the app picks is a fabricated clinical result that
 * renders in an employee's table as though a reviewer recorded it. Requiring
 * them does not force a column to exist: a `{ kind: "constant" }` source
 * satisfies the requirement, and that is the whole point. The admin declares
 * "every row in this file is سليمة" ONCE, it is recorded on the import, and it
 * is attributable to a person. Leaving the fields optional made that declaration
 * merely available; requiring them makes it mandatory, which is the only version
 * that cannot silently invent a result.
 */

import type { AdhocField } from "./adhocImportModel";

/** The two literal values `PreparedPopulationRow.xrayLevelOne/TwoResult` accept. */
const RESULT_OPTIONS = ["سليمة", "اشتباه"];

/** `PreparedPopulationRow.certScanStatus` (`CertScanMatchStatus`) — exactly these two. */
const CERT_SCAN_OPTIONS = ["Certscan", "NonCertscan"];

/**
 * The canonical stage labels `formatStageLabel` emits (`STAGE_LABELS_AR` in
 * `src/data/population/stageHelpers.ts`). The many raw spellings a file may
 * carry (`STAGE_2`, `الثاني`, `2`, …) are `DEFAULT_STAGE_MAPPINGS` aliases and
 * belong in the import's per-value mapping, not here: `options` is what a
 * mapped value must RESOLVE TO, so it holds the canonical four only.
 */
const STAGE_OPTIONS = [
  "المستوى الأول",
  "المستوى الثاني",
  "المستوى الثالث",
  "المستوى الرابع",
];

export const ADHOC_FIELD_CATALOG: AdhocField[] = [
  {
    key: "xrayImageId",
    labelAr: "معرف الأشعة",
    required: true,
    kind: "text",
    seedAliases: [
      "معرف الأشعة",
      "معرف الاشعة",
      "رقم صورة الأشعة",
      "رقم صورة الاشعة",
      "XRAY_SCAN_ID",
    ],
  },
  {
    key: "xrayEntryDate",
    labelAr: "تاريخ دخول الأشعة",
    required: false,
    kind: "date",
    seedAliases: [
      "تاريخ دخول الأشعة",
      "تاريخ دخول الاشعة",
      "تاريخ الاشعة",
      "تاريخ الأشعة",
    ],
  },
  {
    key: "portCode",
    labelAr: "رمز المنفذ",
    required: false,
    kind: "text",
    seedAliases: ["رمز المنفذ", "المنفذ", "رمز الجمرك", "PORT_CD"],
  },
  {
    key: "portName",
    labelAr: "اسم المنفذ",
    required: false,
    kind: "text",
    seedAliases: ["اسم المنفذ"],
  },
  {
    key: "portType",
    labelAr: "نوع المنفذ",
    required: false,
    kind: "text",
    seedAliases: ["نوع المنفذ"],
  },
  {
    key: "declarationNumber",
    labelAr: "رقم البيان",
    required: false,
    kind: "text",
    seedAliases: ["رقم البيان", "رقم البيان المبدئي", "رقم بيان الترانزيت"],
  },
  {
    key: "plateOrContainerNumber",
    labelAr: "رقم اللوحة/الحاوية",
    required: false,
    kind: "text",
    seedAliases: [
      "رقم اللوحة",
      "رقم الحاوية",
      "رقم تسلسل الحاوية",
      "PLATE_NO",
      "رقم اللوحة\\الحاوية",
      "رقم اللوحة/الحاوية",
    ],
  },
  {
    key: "chassisNumber",
    labelAr: "رقم الهيكل",
    required: false,
    kind: "text",
    seedAliases: ["رقم الهيكل", "رقم الشاص"],
  },
  {
    key: "xrayLevelOneResult",
    labelAr: "نتيجة المستوى الأول",
    // Satisfiable by a constant — see the module header. Required so that an
    // unmapped pair fails loudly at review time instead of being invented.
    required: true,
    kind: "enum",
    options: RESULT_OPTIONS,
    seedAliases: [
      "نتيجة المستوى الأول",
      "نتيجة المستوى الاول",
      "المستوى الاول",
      "نتيجة المستوى الأول للاشعة",
      "نتيجة المستوى الأول للأشعة",
    ],
  },
  {
    key: "xrayLevelTwoResult",
    labelAr: "نتيجة المستوى الثاني",
    // Satisfiable by a constant — see `xrayLevelOneResult` above.
    required: true,
    kind: "enum",
    options: RESULT_OPTIONS,
    seedAliases: [
      "نتيجة المستوى الثاني",
      "نتيجة المستوى الثاني للاشعة",
      "المستوى الثاني",
      "نتيجة المستوى الثاني للأشعة",
    ],
  },
  {
    // Its "المستوى" alias is a substring of the L1/L2 headers, so on a file
    // carrying both this field and a result column compete for one header.
    // `autoDetectMapping` settles that by match strength (the result field's
    // verbatim match beats this alias's containment), not by catalog position —
    // the order here just mirrors the Population catalog.
    key: "stage",
    labelAr: "المستوى",
    required: false,
    kind: "enum",
    options: STAGE_OPTIONS,
    seedAliases: ["STAGE", "المستوى"],
  },
  {
    key: "movementType",
    labelAr: "نوع الحركة",
    required: false,
    kind: "text",
    seedAliases: ["نوع الحركة"],
  },
  {
    key: "reportNumber",
    labelAr: "رقم المحضر",
    required: false,
    kind: "text",
    seedAliases: ["رقم المحضر"],
  },
  {
    key: "targetedByRiskEngine",
    labelAr: "مستهدف محرك المخاطر",
    required: false,
    kind: "text",
    seedAliases: [
      "مستهدف محرك المخاطر",
      "مستهدف من محرك المخاطر",
      "استهداف محرك مخاطر",
    ],
  },
  {
    key: "riskMessage",
    labelAr: "رسالة المخاطر",
    required: false,
    kind: "text",
    seedAliases: ["رسالة المخاطر"],
  },
  {
    key: "levelOneEmployee",
    labelAr: "موظف المستوى الأول",
    required: false,
    kind: "text",
    // No entry in `DEFAULT_MAPPING_TEMPLATE.columnMappings` (the regular
    // pipeline fills these from BI, not from the risk sheet's headers), so the
    // aliases here are the label's spelling variants only.
    seedAliases: ["موظف المستوى الأول", "موظف المستوى الاول"],
  },
  {
    key: "levelTwoEmployee",
    labelAr: "موظف المستوى الثاني",
    required: false,
    kind: "text",
    seedAliases: ["موظف المستوى الثاني"],
  },
  {
    // Not in the Population catalog. v1 hardcoded every ad-hoc row to
    // "NonCertscan", which quietly reported CertScan-scanned images as
    // un-scanned in any report that groups by this field. It is a mappable
    // column now (or a declared constant, for a file that is all one or the
    // other).
    key: "certScanStatus",
    labelAr: "حالة CertScan",
    required: false,
    kind: "enum",
    options: CERT_SCAN_OPTIONS,
    seedAliases: [
      "حالة CertScan",
      "CertScan",
      "CERTSCAN",
      "سيرت سكان",
      "حالة سيرت سكان",
    ],
  },
  {
    // Not in the Population catalog either. Feeds
    // `AdhocMonthBinding { kind: "column" }` — but ONLY as an ordinary catalog
    // entry the admin mapped like any other: nothing anywhere may look for a
    // column literally named "شهر الفحص", which is how a per-file header
    // spelling turns into an invisible parsing rule.
    key: "studyMonth",
    labelAr: "شهر الفحص",
    required: false,
    kind: "month",
    seedAliases: [
      "شهر الفحص",
      "شهر الدراسة",
      "الشهر",
      "شهر",
      "تاريخ الفحص",
      "شهر التقرير",
      "STUDY_MONTH",
      "MONTH",
    ],
  },
];

export function getAdhocField(
  catalog: AdhocField[],
  key: string
): AdhocField | undefined {
  return catalog.find((field) => field.key === key);
}
