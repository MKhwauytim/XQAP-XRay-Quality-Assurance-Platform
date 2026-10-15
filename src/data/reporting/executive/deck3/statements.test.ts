import { describe, expect, it } from "vitest";
import type { ExecutiveReportRow } from "../../executiveReportTypes";
import type { ReportModel } from "../model/reportModel";
import type { StageCountKey } from "../../../population/stageHelpers";
import { findOutliers, typeTotal, OBSERVATION_TYPES, buildObservations, type Answer, type Ctx, type Image, type PortShare } from "./statements";

const port = (name: string, sea: boolean, num: number, den: number): PortShare => ({ name, sea, num, den });

describe("typeTotal — the pooled «إجمالي» of one port type", () => {
  it("pools counts, so a big port weighs more than a small one", () => {
    const stats = [port("كبير", false, 900, 1000), port("صغير", false, 10, 100), port("بحري", true, 50, 100)];
    expect(typeTotal(stats, false)).toBeCloseTo((910 / 1100) * 100, 5);
    expect(typeTotal(stats, true)).toBeCloseTo(50, 5);
  });
  it("is null for a type with no cases", () => {
    expect(typeTotal([port("أ", false, 1, 10)], true)).toBeNull();
  });
});

describe("findOutliers — a port against its own port type's total", () => {
  const stats = [
    port("البطحاء", false, 450, 1000),
    port("الحديثة", false, 150, 1000),
    port("جديدة عرعر", false, 150, 1000),
    port("صغير", false, 90, 90),
    port("ميناء جدة", true, 340, 1000),
    port("ميناء الملك عبدالعزيز", true, 100, 1000),
  ];
  it("names land ports far above the land total only, and skips ports under the minimum base", () => {
    const high = findOutliers(stats, false, "high");
    expect(high.map((o) => o.name)).toEqual(["البطحاء"]);
    expect(high[0].baseShare).toBeCloseTo((840 / 3090) * 100, 5);
  });
  it("judges sea ports against the sea total, never the land one", () => {
    expect(findOutliers(stats, true, "high").map((o) => [o.name, Math.round(o.baseShare)])).toEqual([["ميناء جدة", 22]]);
  });
  it("finds low outliers worst first", () => {
    const low = findOutliers([port("أ", false, 900, 1000), port("ب", false, 100, 1000), port("ج", false, 300, 1000)], false, "low");
    expect(low.map((o) => o.name)).toEqual(["ب", "ج"]);
  });
});

// ── Trigger tests: each observation type fires on data past its threshold and stays silent otherwise ─────────────

type RowBits = Partial<Pick<ExecutiveReportRow, "imageQuality" | "imageResult" | "hasMarking" | "answerStatus" | "imageAvailable">>;
const row = (bits: RowBits = {}): ExecutiveReportRow => ({ imageQuality: "عالي", imageResult: "سليمة", hasMarking: null, answerStatus: "submitted", imageAvailable: true, ...bits }) as ExecutiveReportRow;

type Spec = { n: number; outcome: Answer["outcome"]; level?: "l1" | "l2"; stage?: StageCountKey; port?: string | null; bits?: RowBits };
const answers = (...specs: Spec[]): Answer[] =>
  specs.flatMap((s) => Array.from({ length: s.n }, (_, i): Answer => ({
    row: row(s.bits), outcome: s.outcome, level: s.level ?? (i % 2 ? "l2" : "l1"), stage: s.stage ?? "second", port: s.port === undefined ? "البطحاء" : s.port, sea: false,
  })));
const images = (n: number, bits: RowBits, portName: string | null = "البطحاء"): Image[] =>
  Array.from({ length: n }, () => ({ row: row(bits), stage: "second" as StageCountKey, port: portName, sea: false }));

const model = { population: { summary: undefined }, errorAnalysis: { totals: { evaluable: 1 } } } as unknown as ReportModel;
const ctx = (a: Answer[] = [], i: Image[] = []): Ctx => ({ model, answers: a, images: i });
const fires = (id: string, c: Ctx) => {
  const type = OBSERVATION_TYPES.find((t) => t.id === id);
  if (!type) throw new Error(`no type ${id}`);
  return type.build(c)?.observation ?? null;
};

describe("observation triggers", () => {
  it("missed-high: fires at 20% missed of clean answers, silent at 10%", () => {
    const o = fires("missed-high", ctx(answers({ n: 200, outcome: "ms" }, { n: 800, outcome: "cc" })));
    expect(o?.title).toContain("20.0%");
    expect(o?.recommendations).toHaveLength(3);
    expect(fires("missed-high", ctx(answers({ n: 100, outcome: "ms" }, { n: 900, outcome: "cc" })))).toBeNull();
  });

  it("missed-low: the positive mirror fires at 3%, silent at 10%", () => {
    expect(fires("missed-low", ctx(answers({ n: 30, outcome: "ms" }, { n: 970, outcome: "cc" })))?.priority).toBe("للعلم");
    expect(fires("missed-low", ctx(answers({ n: 100, outcome: "ms" }, { n: 900, outcome: "cc" })))).toBeNull();
  });

  it("thin groups never fire, however extreme the share", () => {
    expect(fires("missed-high", ctx(answers({ n: 100, outcome: "ms" }, { n: 100, outcome: "cc" })))).toBeNull();
  });

  it("false-high: fires at 30% false of suspicion answers and quotes level 4; silent at 15%", () => {
    const o = fires("false-high", ctx(answers({ n: 300, outcome: "fs", stage: "fourth" }, { n: 700, outcome: "cs", stage: "fourth" })));
    expect(o?.evidence[0].text).toContain("مستوى المخاطر الرابع");
    expect(fires("false-high", ctx(answers({ n: 150, outcome: "fs" }, { n: 850, outcome: "cs" })))).toBeNull();
  });

  it("false-low: fires at 5%, silent at 15%", () => {
    expect(fires("false-low", ctx(answers({ n: 50, outcome: "fs" }, { n: 950, outcome: "cs" })))).not.toBeNull();
    expect(fires("false-low", ctx(answers({ n: 150, outcome: "fs" }, { n: 850, outcome: "cs" })))).toBeNull();
  });

  it("level-three-missed: fires at 10% missed of level-3 answers, silent at 2%", () => {
    expect(fires("level-three-missed", ctx(answers({ n: 100, outcome: "ms", stage: "third" }, { n: 900, outcome: "cc", stage: "third" })))?.title).toContain("مستوى المخاطر الثالث");
    expect(fires("level-three-missed", ctx(answers({ n: 20, outcome: "ms", stage: "third" }, { n: 980, outcome: "cc", stage: "third" })))).toBeNull();
  });

  it("marking-low: fires when 40% of suspicion images are marked, silent at 90%", () => {
    const imgs = (marked: number) => [...images(marked, { imageResult: "اشتباه", hasMarking: true }), ...images(1000 - marked, { imageResult: "اشتباه", hasMarking: false })];
    expect(fires("marking-low", ctx([], imgs(400)))?.title).toContain("(40%)");
    expect(fires("marking-low", ctx([], imgs(900)))).toBeNull();
  });

  it("quality-poor: fires at 30% medium/low images and names the outlier port; silent at 10%", () => {
    const imgs = [...images(300, { imageQuality: "متوسط" }, "سلوى"), ...images(700, { imageQuality: "عالي" }, "البطحاء")];
    expect(fires("quality-poor", ctx([], imgs))?.evidence.some((e) => e.text.includes("منفذ سلوى (100%)"))).toBe(true);
    expect(fires("quality-poor", ctx([], [...images(100, { imageQuality: "متوسط" }), ...images(900, { imageQuality: "عالي" })]))).toBeNull();
  });

  it("quality-linked-errors: fires when low-quality agreement trails high-quality by 20 points, silent when equal", () => {
    const low = (agree: number) => answers({ n: agree, outcome: "cc", bits: { imageQuality: "منخفض" } }, { n: 500 - agree, outcome: "ms", bits: { imageQuality: "منخفض" } });
    const high = answers({ n: 450, outcome: "cc" }, { n: 50, outcome: "ms" });
    expect(fires("quality-linked-errors", ctx([...low(350), ...high]))).not.toBeNull();
    expect(fires("quality-linked-errors", ctx([...low(450), ...high]))).toBeNull();
  });

  it("level-gap: fires when L1 agreement trails L2 by 20 points, silent when the levels agree alike", () => {
    const a = answers({ n: 300, outcome: "cc", level: "l1" }, { n: 200, outcome: "ms", level: "l1" }, { n: 400, outcome: "cc", level: "l2" }, { n: 100, outcome: "ms", level: "l2" });
    expect(fires("level-gap", ctx(a))?.title).toContain("المستوى الأول");
    const b = answers({ n: 400, outcome: "cc", level: "l1" }, { n: 100, outcome: "ms", level: "l1" }, { n: 400, outcome: "cc", level: "l2" }, { n: 100, outcome: "ms", level: "l2" });
    expect(fires("level-gap", ctx(b))).toBeNull();
  });

  it("missing-image: fires at 10% «لا يوجد صورة», silent at 1%", () => {
    expect(fires("missing-image", ctx([], [...images(100, { imageAvailable: false }), ...images(900, {})]))).not.toBeNull();
    expect(fires("missing-image", ctx([], [...images(10, { imageAvailable: false }), ...images(990, {})]))).toBeNull();
  });

  it("error-concentration: fires when one port holds most errors but few answers, silent when errors spread evenly", () => {
    const concentrated = answers(
      { n: 300, outcome: "ms", port: "البطحاء" }, { n: 200, outcome: "cc", port: "البطحاء" },
      { n: 50, outcome: "ms", port: "الحديثة" }, { n: 1450, outcome: "cc", port: "الحديثة" },
    );
    expect(fires("error-concentration", ctx(concentrated))?.title).toContain("منفذ البطحاء");
    const even = answers(
      { n: 200, outcome: "ms", port: "البطحاء" }, { n: 800, outcome: "cc", port: "البطحاء" },
      { n: 200, outcome: "ms", port: "الحديثة" }, { n: 800, outcome: "cc", port: "الحديثة" },
    );
    expect(fires("error-concentration", ctx(even))).toBeNull();
  });

  it("placeholder ports are never named", () => {
    const a = answers({ n: 300, outcome: "ms", port: null }, { n: 700, outcome: "cc", port: "البطحاء" });
    expect(fires("missed-high", ctx(a))?.evidence.every((e) => !e.text.includes("غير محدد"))).toBe(true);
  });
});

describe("buildObservations", () => {
  it("returns nothing when no answer can be judged", () => {
    expect(buildObservations({ ...model, rows: [], errorAnalysis: { totals: { evaluable: 0 } } } as unknown as ReportModel)).toEqual([]);
  });
});
