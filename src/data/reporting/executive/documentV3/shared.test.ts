import { describe, it, expect } from "vitest";
import {
  docPage,
  docCover,
  docClosing,
  docSectionDivider,
  docPageHeader,
  docKpiStrip,
  docPanel,
  docTwoColumn,
  docPaginateTable,
} from "./shared";

describe("documentV3 shared chrome", () => {
  it("docPage wraps body content in a .docpage.v3 shell with the given id/title", () => {
    const html = docPage({ id: "s1-overview", title: "لمحة عامة", pageNo: "01", body: "<p>test</p>" });
    expect(html).toContain('class="docpage v3"');
    expect(html).toContain('id="s1-overview"');
    expect(html).toContain("<p>test</p>");
    expect(html).toContain("01");
  });

  it("docCover renders the org block, title, and period", () => {
    const html = docCover({
      org: { logoUrl: "", orgName: "الهيئة", lines: [] },
      title: "تقرير المجتمع",
      periodLabel: "الشهر",
      periodValue: "أغسطس ٢٠٢٦",
      metaRows: [],
    });
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("أغسطس ٢٠٢٦");
  });

  it("docSectionDivider renders a ghost numeral and title", () => {
    const html = docSectionDivider({ ghost: "١", kicker: "القسم الأول", title: "المجتمع", description: "" });
    expect(html).toContain("القسم الأول");
    expect(html).toContain("المجتمع");
  });

  it("escapes untrusted content in docPageHeader", () => {
    const html = docPageHeader({ eyebrow: "<script>alert(1)</script>", title: "عنوان" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes untrusted content in docPage's title", () => {
    const html = docPage({
      id: "s1",
      title: "<script>alert(1)</script>",
      pageNo: "01",
      body: "<p>test</p>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes untrusted content in docCover's title and periodValue", () => {
    const html = docCover({
      org: { logoUrl: "", orgName: "الهيئة", lines: [] },
      title: "<script>alert(1)</script>",
      periodLabel: "الشهر",
      periodValue: "<script>alert(2)</script>",
      metaRows: [],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("escapes untrusted content in docClosing's closingLine", () => {
    const html = docClosing({
      org: { logoUrl: "", orgName: "الهيئة", lines: [] },
      title: "الخاتمة",
      closingLine: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes untrusted content in docSectionDivider's title and description", () => {
    const html = docSectionDivider({
      ghost: "١",
      kicker: "القسم الأول",
      title: "<script>alert(1)</script>",
      description: "<script>alert(2)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("docPanel renders the given title and body without throwing", () => {
    const html = docPanel("عنوان اللوحة", "<p>محتوى</p>");
    expect(html).toContain("عنوان اللوحة");
    expect(html).toContain("<p>محتوى</p>");
  });

  it("docTwoColumn renders both land and sea panel titles without throwing", () => {
    const html = docTwoColumn({
      land: { title: "البر", body: "<p>أ</p>" },
      sea: { title: "البحر", body: "<p>ب</p>" },
    });
    expect(html).toContain("البر");
    expect(html).toContain("البحر");
  });

  it("docKpiStrip renders the given KPI labels without throwing", () => {
    const html = docKpiStrip([{ label: "المؤشر الأول", value: "10" }]);
    expect(html).toContain("المؤشر الأول");
    expect(html).toContain("10");
  });

  it("docPaginateTable splits rows into chunks of the given page size, repeating headers", () => {
    const rows = Array.from({ length: 25 }, (_, i) => [{ html: String(i) }]);
    const chunks = docPaginateTable({ headers: ["#"], rows, rowsPerPage: 10 });
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toContain("24");
  });
});
