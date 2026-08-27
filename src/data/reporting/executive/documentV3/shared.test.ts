import { describe, it, expect } from "vitest";
import { docPage, docCover, docSectionDivider, docPageHeader, docPaginateTable } from "./shared";

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

  it("docPaginateTable splits rows into chunks of the given page size, repeating headers", () => {
    const rows = Array.from({ length: 25 }, (_, i) => [{ html: String(i) }]);
    const chunks = docPaginateTable({ headers: ["#"], rows, rowsPerPage: 10 });
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toContain("24");
  });
});
