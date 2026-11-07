import { describe, expect, it } from "vitest";
import { contentHead, dataTable, kpiBand, tintedPanel } from "./slideKit";
import { barChart, groupedBarChart } from "./chartKit";

describe("deck3 kit snapshot", () => {
  it("kpiBand", () => {
    const html = kpiBand(
      [
        { label: "إجمالي", value: "120", valueTone: "gold", aside: "عينة" },
        { label: "المطابقة", value: "85%", valueTone: "gold", sub: "من الإجمالي" },
      ],
      "top",
    );
    expect(html).toMatchSnapshot();
  });

  it("tintedPanel", () => {
    expect(tintedPanel({ variant: "sea", title: "بحري", body: "<p>x</p>" })).toMatchSnapshot();
  });

  it("contentHead", () => {
    expect(contentHead({ eyebrow: "القسم", title: "العنوان", note: "ملاحظة" })).toMatchSnapshot();
  });

  it("dataTable with totals", () => {
    const html = dataTable({
      headers: ["الميناء", "العدد", "النسبة"],
      rows: [
        [{ html: "جدة" }, { html: "10" }, { html: "50%" }],
        [{ html: "الدمام" }, { html: "6" }, { html: "30%" }],
        [{ html: "الرياض" }, { html: "4" }, { html: "20%" }],
      ],
      totals: [{ html: "الإجمالي" }, { html: "20" }, { html: "100%" }],
    });
    expect(html).toMatchSnapshot();
  });

  it("barChart", () => {
    const html = barChart({
      bars: [
        { label: "أ", value: 40 },
        { label: "ب", value: null },
      ],
      min: 0,
      max: 100,
    });
    expect(html).toMatchSnapshot();
  });

  it("groupedBarChart", () => {
    const html = groupedBarChart({
      groups: [
        { label: "جدة", a: { label: "أ", value: 30 }, b: { label: "ب", value: 70 } },
        { label: "الدمام", a: { label: "أ", value: 55 }, b: { label: "ب", value: null } },
      ],
      min: 0,
      max: 100,
    });
    expect(html).toMatchSnapshot();
  });
});
