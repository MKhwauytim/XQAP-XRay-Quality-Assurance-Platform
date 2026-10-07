import type { PopulationBucket, PopulationSummary } from "../reporting/executiveReportTypes";

/**
 * Totals-only fold of the workbook's monthly population sheets (`JAN`…`DEC`).
 * Rows are tallied and discarded — a population is hundreds of thousands of
 * rows and the comprehensive report only needs its totals.
 *
 * A result that is neither سليمة nor اشتباه is counted as `other` (never
 * guessed into either bucket). The one exception is the January sheet, which
 * stores the result as a numeric code: 1 → سليمة, 2 → اشتباه (confirmed by
 * matching January's sample sheet against it); every other code stays `other`.
 */

type Level = "clean" | "suspicious" | "other";
type PortAcc = PopulationBucket & { name: string; portType: string | null };

const UNKNOWN_PORT = "غير محدد";
const JAN_CODES: Record<string, Level> = { "1": "clean", "2": "suspicious" };

export type PopulationFold = {
  add(cells: Record<string, string>, numericCodes: boolean): void;
  finish(sheets: Array<{ name: string; rows: number }>): PopulationSummary;
};

function classify(raw: string | undefined, numericCodes: boolean): { level: Level; label: string | null } {
  const s = (raw ?? "").trim();
  if (s === "سليمة" || s === "سليمه") return { level: "clean", label: null };
  if (s === "اشتباه") return { level: "suspicious", label: null };
  if (numericCodes && JAN_CODES[s]) return { level: JAN_CODES[s], label: null };
  return { level: "other", label: s === "" ? "فارغ" : s };
}

const emptyBucket = (): PopulationBucket => ({ total: 0, clean: 0, suspicious: 0, other: 0 });

/** The image-result OR rule: any اشتباه wins; both سليمة is clean; anything else is `other`. */
function imageLevel(l1: Level, l2: Level): Level {
  if (l1 === "suspicious" || l2 === "suspicious") return "suspicious";
  return l1 === "clean" && l2 === "clean" ? "clean" : "other";
}

function tally(b: PopulationBucket, level: Level): void {
  b.total++;
  b[level]++;
}

export function createPopulationFold(): PopulationFold {
  let total = 0;
  const byStage = new Map<string, PopulationBucket>();
  const byPort = new Map<string, PortAcc>();
  const byStageLevels = new Map<string, { levelOne: Record<Level, number>; levelTwo: Record<Level, number> }>();
  const levelOne = { clean: 0, suspicious: 0, other: 0 };
  const levelTwo = { clean: 0, suspicious: 0, other: 0 };
  const otherValues = { levelOne: {} as Record<string, number>, levelTwo: {} as Record<string, number> };

  return {
    add(cells, numericCodes) {
      const id = (cells["معرف الأشعة"] ?? "").trim();
      const stage = (cells["المستوى"] ?? "").trim();
      if (!id || !stage) return;
      const a = classify(cells["نتيجة المستوى الأول"], numericCodes);
      const b = classify(cells["نتيجة المستوى الثاني"], numericCodes);
      levelOne[a.level]++;
      levelTwo[b.level]++;
      let sl = byStageLevels.get(stage);
      if (!sl) byStageLevels.set(stage, (sl = { levelOne: { clean: 0, suspicious: 0, other: 0 }, levelTwo: { clean: 0, suspicious: 0, other: 0 } }));
      sl.levelOne[a.level]++;
      sl.levelTwo[b.level]++;
      if (a.label !== null) otherValues.levelOne[a.label] = (otherValues.levelOne[a.label] ?? 0) + 1;
      if (b.label !== null) otherValues.levelTwo[b.label] = (otherValues.levelTwo[b.label] ?? 0) + 1;
      const img = imageLevel(a.level, b.level);
      total++;
      let st = byStage.get(stage);
      if (!st) byStage.set(stage, (st = emptyBucket()));
      tally(st, img);
      const name = (cells["اسم المنفذ"] ?? "").trim() || UNKNOWN_PORT;
      let port = byPort.get(name);
      if (!port) byPort.set(name, (port = { ...emptyBucket(), name, portType: null }));
      const type = (cells["نوع المنفذ"] ?? "").trim();
      if (port.portType === null && type !== "") port.portType = type;
      tally(port, img);
    },
    finish(sheets) {
      return {
        total,
        byStage: Object.fromEntries(byStage),
        byPort: [...byPort.values()].sort((x, y) => y.total - x.total),
        levelOne,
        levelTwo,
        byStageLevels: Object.fromEntries(byStageLevels),
        otherValues,
        sheets,
      };
    },
  };
}
