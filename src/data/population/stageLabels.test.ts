import { describe, expect, it } from "vitest";
import {
  STAGE_COUNT_KEY_ORDER,
  STAGE_KEY_ORDER,
  STAGE_LABELS_AR,
  STAGE_UNKNOWN_LABEL,
  compareStageKeys,
  isCanonicalStageKey,
  stageLabelForKey,
  stageLabelRank,
} from "./stageLabels";
import * as stageHelpers from "./stageHelpers";

describe("stageLabels — the one canonical stage definition (C1)", () => {
  it("orders the four levels first→fourth and appends unknown for the count order", () => {
    expect(STAGE_KEY_ORDER).toEqual(["first", "second", "third", "fourth"]);
    expect(STAGE_COUNT_KEY_ORDER).toEqual(["first", "second", "third", "fourth", "unknown"]);
  });

  it("labels each level in Arabic and names the unknown bucket", () => {
    expect(STAGE_LABELS_AR).toEqual({
      first: "المستوى الأول",
      second: "المستوى الثاني",
      third: "المستوى الثالث",
      fourth: "المستوى الرابع",
    });
    expect(STAGE_UNKNOWN_LABEL).toBe("غير محدد");
  });

  it("compareStageKeys sorts first→fourth, then unknown, then anything else", () => {
    const keys = ["unknown", "zzz", "fourth", "first", "third", "second"];
    expect([...keys].sort(compareStageKeys)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "unknown",
      "zzz",
    ]);
  });

  it("stageLabelForKey maps keys to labels, unknown to «غير محدد», anything else through", () => {
    expect(stageLabelForKey("third")).toBe("المستوى الثالث");
    expect(stageLabelForKey("unknown")).toBe("غير محدد");
    expect(stageLabelForKey("L1")).toBe("L1");
  });

  it("isCanonicalStageKey accepts only the four level keys", () => {
    expect(isCanonicalStageKey("first")).toBe(true);
    expect(isCanonicalStageKey("fourth")).toBe(true);
    expect(isCanonicalStageKey("unknown")).toBe(false);
    expect(isCanonicalStageKey("0")).toBe(false);
  });

  it("stageLabelRank ranks the Arabic labels 1–4 and nothing else", () => {
    expect(stageLabelRank("المستوى الأول")).toBe(1);
    expect(stageLabelRank("المستوى الرابع")).toBe(4);
    expect(stageLabelRank("غير محدد")).toBeUndefined();
    expect(stageLabelRank("FIRST_STAGE")).toBeUndefined();
  });

  it("stageHelpers re-exports the same objects (one definition, not a copy)", () => {
    expect(stageHelpers.STAGE_LABELS_AR).toBe(STAGE_LABELS_AR);
    expect(stageHelpers.STAGE_KEY_ORDER).toBe(STAGE_KEY_ORDER);
    expect(stageHelpers.compareStageKeys).toBe(compareStageKeys);
  });

  it("stageBucketLabel buckets raw aliases, custom aliases and unmapped values", () => {
    expect(stageHelpers.stageBucketLabel("SECOND_STAG")).toBe("المستوى الثاني");
    expect(stageHelpers.stageBucketLabel("FORTH_STAGE")).toBe("المستوى الرابع");
    expect(stageHelpers.stageBucketLabel("LEVEL-X")).toBe("غير محدد");
    expect(stageHelpers.stageBucketLabel(null)).toBe("غير محدد");
    expect(stageHelpers.stageBucketLabel("Level A", { first: ["Level A"] })).toBe("المستوى الأول");
  });
});
