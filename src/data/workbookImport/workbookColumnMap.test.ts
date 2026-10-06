import { describe, expect, it } from "vitest";
import { mapSampleRow, newMappingReport } from "./workbookColumnMap";

const base = {
  "معرف الأشعة": "30B8202512010003", "الشهر": "46023", "المستوى": "FORTH_STAGE",
  "نتيجة المستوى الأول": "اشتباه", "نتيجة المستوى الثاني": "سليمة", "صحة النتيجة": "سليمة",
  "الاكتمال": "مكتمل", "هل يوجد صورة؟": "نعم", "هل يوجد تحديد؟": "لا", "مستوى جودة الصورة": "عالي",
  "اسم المنفذ": "ميناء", "نوع المنفذ": "منفذ بحري", "رمز المنفذ": "30",
};
describe("mapSampleRow", () => {
  it("maps a completed row", () => {
    const r = newMappingReport();
    const m = mapSampleRow(base, "Q1_Sample", r)!;
    expect(m.month).toBe("1-january-2026");
    expect(m.row.expertResult).toBe("سليمة");
    expect(m.row.imageAvailable).toBe(true);
    expect(m.row.hasMarking).toBe(false);
    expect(m.row.imageQuality).toBe("عالي");
    expect(m.row.answerStatus).toBe("submitted");
    expect(r.completed).toBe(1);
  });
  it("counts incomplete without mapping", () => {
    const r = newMappingReport();
    expect(mapSampleRow({ ...base, "الاكتمال": "" }, "Q1_Sample", r)).toBeNull();
    expect(r.incomplete).toBe(1);
  });
  it("counts missing id / month / level result", () => {
    const r = newMappingReport();
    mapSampleRow({ ...base, "معرف الأشعة": "" }, "S", r);
    mapSampleRow({ ...base, "الشهر": "" }, "S", r);
    mapSampleRow({ ...base, "نتيجة المستوى الأول": "؟" }, "S", r);
    expect([r.skippedNoId, r.skippedNoMonth, r.skippedBadResult]).toEqual([1, 1, 1]);
    expect(r.unmappedValues["نتيجة المستوى الأول"]["؟"]).toBe(1);
  });
  it("maps invalid image id to unavailable with reason", () => {
    const m = mapSampleRow({ ...base, "هل يوجد صورة؟": "معرف غير صحيح" }, "S", newMappingReport())!;
    expect(m.row.imageAvailable).toBe(false);
    expect(m.row.noImageReason).toBe("معرف غير صحيح");
  });
  it("unknown image value is null and counted once", () => {
    const r = newMappingReport();
    const m = mapSampleRow({ ...base, "هل يوجد صورة؟": "ربما" }, "S", r)!;
    expect(m.row.imageAvailable).toBeNull();
    expect(r.unmappedValues["هل يوجد صورة؟"]["ربما"]).toBe(1);
  });
  it("لا gives unavailable with null reason", () => {
    const m = mapSampleRow({ ...base, "هل يوجد صورة؟": "لا" }, "S", newMappingReport())!;
    expect(m.row.imageAvailable).toBe(false);
    expect(m.row.noImageReason).toBeNull();
  });
  it("unknown marking value counted", () => {
    const r = newMappingReport();
    const m = mapSampleRow({ ...base, "هل يوجد تحديد؟": "ربما" }, "S", r)!;
    expect(m.row.hasMarking).toBeNull();
    expect(r.unmappedValues["هل يوجد تحديد؟"]["ربما"]).toBe(1);
  });
  it("month-end serials", () => {
    const mo = (v: string) => mapSampleRow({ ...base, "الشهر": v }, "S", newMappingReport())!.month;
    expect(mo("46053")).toBe("1-january-2026");
    expect(mo("46054")).toBe("2-february-2026");
  });
});
